import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { QualityOption, Track, WatchView as WatchData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { DanmakuField, toDanmakuItems } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useDanmakuSettings } from '../player/danmakuSettings'
import { usePlayerStore } from '../player/playerStore'
import { VolumeControl } from '../player/VolumeControl'
import { CommentsPanel } from './CommentsPanel'
import { useReactionStore } from '../reactions/reactionStore'
import { toastDone } from '../../app/notice'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'

/** 观看页的倍速档位，和 B 站播放器一致。 */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

/**
 * 观看页。
 *
 * 画面由 shaka 播 DASH，清单来自 Rust 侧合成的只含视频轨的 MPD。
 * 清单与分片都走本机代理，前端拿不到任何远端地址。
 *
 * 声音只有一个发声者，就是音频引擎。视频元素始终静音，只负责画面，
 * 并且跟着引擎的时钟走：暂停、拖动、换档都以引擎为准。
 */
export function WatchView({ track }: { track: Track }) {
  const navigate = useAppStore((s) => s.navigate)
  const goBack = useAppStore((s) => s.goBack)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<ShakaPlayer | null>(null)
  const [data, setData] = useState<WatchData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([])
  const [related, setRelated] = useState<Track[]>([])
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const toggleLike = useReactionStore((st) => st.toggleLike)
  const toggleFav = useReactionStore((st) => st.toggleFav)
  const addCoin = useReactionStore((st) => st.addCoin)
  const refresh = useReactionStore((st) => st.refresh)
  const [page, setPage] = useState<number | undefined>(undefined)
  /** 控制条是否显示。鼠标移动时出现，静止 2.5 秒后淡出；暂停时常驻。 */
  const [controls, setControls] = useState(true)
  const hideTimer = useRef<number | null>(null)
  /** 画质菜单展开状态。 */
  const [qualityOpen, setQualityOpen] = useState(false)
  /** 当前播放位置，只在控制条可见时更新，避免无谓重渲染。 */
  const [now, setNow] = useState(0)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  /** 全屏用浏览器全屏，不支持时退回 CSS 铺满。 */
  const [cinema, setCinema] = useState(false)
  /** 这条视频在不在「稍后再看」里。按钮必须复述服务端的事实，不能只看点击过没有。 */
  const [saved, setSaved] = useState(false)
  /** 有没有关注这个 UP 主。null 表示还没读到（未登录或请求失败），此时不显示按钮。 */
  const [followed, setFollowed] = useState<boolean | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const speed = usePlayerStore((state) => state.snapshot?.speed ?? 1)
  const setSpeed = usePlayerStore((state) => state.setSpeed)
  /**
   * 「引擎在不在放」。
   *
   * 不用 `useIsPlaying()` 订阅：观看页切换的那一刻，全局快照会连着更新好几次，
   * 订阅会让整页重渲染。这里只按 250ms 轮询一次布尔值，页面不会被音频事件牵着走。
   */
  const [playing, setPlaying] = useState(false)
  const danmakuOn = useDanmakuSettings((s) => s.enabled)
  const danmakuOpacity = useDanmakuSettings((s) => s.opacity)
  const danmakuSize = useDanmakuSettings((s) => s.size)
  const danmakuSpeed = useDanmakuSettings((s) => s.speed)
  const setDanmakuEnabled = useDanmakuSettings((s) => s.setEnabled)

  // 取清单与档位
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    setReady(false)
    void (async () => {
      try {
        const next = await ipc.watchOpen(track.key, page)
        if (!cancelled) setData(next)
      } catch (e) {
        if (!cancelled) setError(toWireError(e).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [track.key, page])

  // 取弹幕。时间轴跟引擎时钟走，画面只是它的跟随者。
  useEffect(() => {
    let cancelled = false
    setDanmaku([])
    void ipc
      .danmakuColored(track.key)
      .then((list) => {
        if (!cancelled) setDanmaku(toDanmakuItems(list))
      })
      .catch(() => setDanmaku([]))
    return () => {
      cancelled = true
    }
  }, [track.key])

  // 打开就把这条视频的真实点赞/收藏/投币状态拉回来，
  // 否则按钮看起来永远是未点过的。
  useEffect(() => {
    // 用 refresh 而不是 hydrate：hydrate 会跳过查过的 key，而详情页
    // 打开时必须显示服务端真实状态，不能吃缓存。
    void refresh([track.key]).catch(() => {
      // 未登录时拉不到，保持未点亮即可
    })
  }, [track.key, refresh])

  // 稍后再看的初始状态取自服务端列表；拿不到就当没加入，不猜。
  useEffect(() => {
    let cancelled = false
    setSaved(false)
    void ipc
      .watchLaterList()
      .then((list) => {
        if (!cancelled) setSaved(list.some((t) => t.key === track.key))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track.key])

  // 关注状态只能从服务端读：没登录或读不到时保持 null，宁可不显示按钮，也不猜。
  useEffect(() => {
    let cancelled = false
    setFollowed(null)
    const mid = data?.owner_mid
    if (!mid) return
    void ipc
      .relationFollowed(mid)
      .then((on) => {
        if (!cancelled) setFollowed(on)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [data?.owner_mid])

  // 相关推荐。右栏只在「听」时出现，所以观看页要有自己的一份，
  // 否则看视频时完全没有相关推荐可点。
  useEffect(() => {
    let cancelled = false
    setRelated([])
    void ipc
      .related(track.key)
      .then((list) => {
        if (!cancelled) setRelated(list)
      })
      .catch(() => setRelated([]))
    return () => {
      cancelled = true
    }
  }, [track.key])

  // 控制条：鼠标动就出现，静止后淡出；暂停时不淡出。
  const poke = (): void => {
    setControls(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControls(false), 2500)
  }
  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  // 位置只在控制条可见时刷新。隐藏时不跑定时器，省掉整页重渲染。
  // 读的是引擎时钟，不是视频元素：声音先到，画面后跟。
  useEffect(() => {
    if (!controls) return
    const timer = window.setInterval(() => setNow(Math.round(readPlayhead())), 500)
    return () => window.clearInterval(timer)
  }, [controls])

  const togglePlay = (): void => {
    void ipc.playerToggle().catch(() => {
      // 没加载起来时点播放不该静默失败，但也不该假装成功
    })
    poke()
  }

  const seekTo = (ratio: number): void => {
    const duration = data?.duration_ms ?? track.duration_ms
    if (!duration) return
    const at = Math.round(Math.min(Math.max(ratio, 0), 1) * duration)
    void ipc.playerSeek(at).catch(() => {})
    const v = videoRef.current
    if (v) v.currentTime = at / 1000
    setNow(at)
    poke()
  }

  const toggleFullscreen = async (): Promise<void> => {
    const box = stageRef.current
    if (!box) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      await box.requestFullscreen()
    } catch {
      // WebView 不支持元素全屏时，用 CSS 铺满顶上
      setCinema((on) => !on)
    }
  }

  const sendDanmaku = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const at = Math.round(readPlayhead())
      await ipc.danmakuSend(track.key, text, at)
      setDraft('')
      // 立刻在本地画出来，不用等下一次拉取
      setDanmaku((prev) => [...prev, { at, text, color: 'var(--text-1)' }])
      poke()
    } catch {
      // 发不出去就留着草稿，不假装成功
    } finally {
      setSending(false)
    }
  }

  // 画面跟随引擎：引擎在放就放，引擎暂停就停，偏差超过 400ms 拉回来。
  // 只看引擎的状态，不看视频自己的 play/pause，避免两个真值打架。
  useEffect(() => {
    if (!ready) return
    const timer = window.setInterval(() => {
      const v = videoRef.current
      if (!v) return
      const snap = usePlayerStore.getState().snapshot
      // 引擎在放别人的时候，画面不能被它拖着走：队列恢复或换歌的瞬间，
      // 快照里可能是另一条曲目。只有「这条视频就是引擎正在放的那条」才跟随。
      const sameTrack = snap?.track?.key === track.key
      const enginePlaying = sameTrack && snap?.phase === 'playing'
      setPlaying(enginePlaying)
      if (!sameTrack) {
        if (!v.paused) v.pause()
        return
      }
      if (!enginePlaying) {
        if (!v.paused) v.pause()
        return
      }
      if (v.paused) void v.play().catch(() => {})
      const drift = v.currentTime * 1000 - readPlayhead()
      if (Math.abs(drift) > 400) v.currentTime = readPlayhead() / 1000
      if (v.playbackRate !== speed) v.playbackRate = speed
    }, 250)
    return () => window.clearInterval(timer)
  }, [ready, track.key, speed])

  // 挂载 shaka
  useEffect(() => {
    const video = videoRef.current
    if (!video || !data) return
    const shaka = (window as unknown as { shaka?: ShakaGlobal }).shaka
    if (!shaka) {
      setError('播放器没加载（缺少 shaka-player）')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        shaka.polyfill?.installAll?.()
        const player = new shaka.Player(video)
        playerRef.current = player
        player.addEventListener('error', (event: { detail?: unknown }) => {
          // shaka 的可恢复错误它自己会重试（例如某个分片 404 之后换 CDN）。
          // 早先任何 error 都当致命，用户会看到一条红字盖在正常播放的画面上。
          const detail = event.detail as { handled?: boolean; severity?: number } | undefined
          if (detail?.handled) return
          setError(`播放失败：${String(event.detail ?? '未知错误')}`)
        })
        video.muted = true
        video.volume = 0
        await player.load(data.manifest_url)
        // shaka 会自动选一档。把当前档位映射回 B 站的画质 id，
        // 否则按钮上只能显示兜底文案「画质」，用户不知道现在是多少。
        const activeVariant = player.getVariantTracks().find((t) => t.active)
        if (activeVariant) {
          const match = data.qualities.find((q) => q.height === activeVariant.height)
          if (match) setActiveId(match.id)
        }
        if (cancelled) {
          await player.destroy()
          return
        }
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(`播放失败：${String(e)}`)
      }
    })()
    return () => {
      cancelled = true
      const player = playerRef.current
      playerRef.current = null
      void player?.destroy()
    }
  }, [data])

  // 换档。shaka 按变体轨道的高度匹配，B 站的画质 id 不直接出现在变体上。
  const pickQuality = (q: QualityOption): void => {
    const player = playerRef.current
    if (!player) return
    const same = player.getVariantTracks().filter((t) => t.height === q.height)
    if (same.length === 0) return
    // 同高度可能有多种码率，取最高的那条
    const best = same.sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
    if (!best) return
    player.selectVariantTrack(best, true)
    setActiveId(q.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <button
          type="button"
          aria-label="返回"
          onClick={() => goBack()}
          className="t press flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[var(--panel-alt)]"
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium">{track.title}</h2>
        <button
          type="button"
          onClick={() => {
            const at = Math.round(readPlayhead())
            void ipc
              .setMode('listen', at, track.key)
              .then(() => {
                // 切到「听」之后回上一层，用户回到刚才浏览的地方
                goBack()
              })
              .catch(() => {
                // 切不过去就留在观看页，不假装成功
              })
          }}
          className="t press shrink-0 rounded-[6px] border border-[var(--line)] px-2 py-1 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)]"
        >
          听视频
        </button>
        <span className="num shrink-0 text-[12px] text-[var(--text-3)]">
          {track.duration_ms ? formatTime(track.duration_ms) : '—'}
        </span>
      </div>

      {/* 左画面右推荐的布局：视频客户端的信息骨架，音乐播放器那套单列竖排不适用。 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={stageRef}
        onMouseMove={poke}
        onMouseLeave={() => setControls(false)}
        className={
          cinema
            ? 'fixed inset-0 z-50 flex flex-col justify-center bg-black'
            : 'relative aspect-video w-full shrink-0 bg-black md:max-h-[64vh]'
        }
      >
        <video
          ref={videoRef}
          muted
          playsInline
          onClick={togglePlay}
          className="h-full w-full cursor-pointer object-contain"
          aria-label="视频画面"
        />
        <DanmakuField
          items={danmaku}
          position={() => Math.round(readPlayhead())}
          playing={playing}
          enabled={danmakuOn}
          opacity={danmakuOpacity}
          size={danmakuSize}
          speed={danmakuSpeed}
          fade
        />
        {!ready && !error ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-white/70">
            正在取流…
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center text-[13px] text-white">
            <span>{error}</span>
            <span className="text-white/60">
              可能的原因：这条内容没有 DASH 视频轨，或本机播放器不支持 MSE。
            </span>
          </div>
        ) : null}

        {/* 控制条浮在画面上：鼠标移上来才出现，静止就淡出。
            视频网站都是这么做的——常驻一条控制条会把画面挤小。 */}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2 pt-10 text-white transition-opacity duration-200 ${
            controls || !playing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* 进度：点哪里跳哪里 */}
          <div
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((now / Math.max(1, track.duration_ms ?? 1)) * 100)}
            tabIndex={0}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              seekTo((event.clientX - box.left) / box.width)
            }}
            className="group relative mb-1.5 h-3 cursor-pointer"
          >
            <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-white/25" />
            <span
              className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--accent)]"
              style={{ width: `${Math.min(100, (now / Math.max(1, track.duration_ms ?? 1)) * 100)}%` }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? '暂停' : '播放'}
              className="t press flex h-7 w-7 items-center justify-center rounded-[4px] hover:bg-white/15"
            >
              <Icon name={playing ? 'pause' : 'play'} size={15} />
            </button>
            <span className="num shrink-0 text-[12px] text-white/85">
              {formatTime(now)} / {formatTime(track.duration_ms ?? 0)}
            </span>

            <div className="min-w-0 flex-1" />

            {/* 发弹幕：跟着画面当前时刻发 */}
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendDanmaku()
              }}
              placeholder="发条弹幕"
              aria-label="发弹幕"
              className="h-7 w-[150px] shrink-0 rounded-[4px] bg-white/15 px-2 text-[12px] text-white placeholder-white/50 outline-none focus:bg-white/25"
            />
            <button
              type="button"
              onClick={() => void sendDanmaku()}
              disabled={!draft.trim() || sending}
              className="t press h-7 shrink-0 rounded-[4px] bg-[var(--accent)] px-2 text-[12px] text-white disabled:opacity-40"
            >
              发送
            </button>

            <button
              type="button"
              aria-pressed={danmakuOn}
              title={danmakuOn ? '关闭弹幕' : '打开弹幕'}
              onClick={() => setDanmakuEnabled(!danmakuOn)}
              className={`t press flex h-7 shrink-0 items-center rounded-[4px] px-2 text-[12px] ${
                danmakuOn ? 'bg-white/20' : 'text-white/60 hover:bg-white/10'
              }`}
            >
              弹
            </button>

            {/* 倍速：跟着引擎走，音频变速，画面用同一个倍率跟随时钟。 */}
            <button
              type="button"
              onClick={() => {
                const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number])
                void setSpeed(SPEEDS[(i + 1) % SPEEDS.length] ?? 1)
              }}
              title="播放倍速"
              aria-label={`播放倍速 ${speed}x`}
              className="t press num h-7 shrink-0 rounded-[4px] px-2 text-[12px] hover:bg-white/15"
            >
              {speed}x
            </button>

            {/* 音量交给引擎：视频元素一直静音，能调的是真正发声的那一路。 */}
            <span
              className="flex shrink-0 items-center"
              style={{ ['--text-2' as string]: 'rgb(255 255 255 / 0.85)' }}
            >
              <VolumeControl />
            </span>

            {data && data.qualities.length > 0 ? (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setQualityOpen((open) => !open)}
                  aria-expanded={qualityOpen}
                  className="t press flex h-7 items-center rounded-[4px] px-2 text-[12px] hover:bg-white/15"
                >
                  {data.qualities.find((q) => q.id === activeId)?.label ?? '画质'}
                </button>
                {qualityOpen ? (
                  <div className="absolute bottom-8 right-0 z-30 flex max-h-[220px] w-[104px] flex-col overflow-y-auto rounded-[6px] border border-white/15 bg-black/90 py-1 backdrop-blur">
                    {data.qualities.map((q) => (
                      <button
                        key={`${q.id}-${q.height}`}
                        type="button"
                        onClick={() => {
                          pickQuality(q)
                          setQualityOpen(false)
                        }}
                        className={`t press px-2 py-1 text-left text-[12px] ${
                          activeId === q.id ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/10'
                        }`}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label="全屏"
              className="t press flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] hover:bg-white/15"
            >
              <Icon name={cinema || document.fullscreenElement ? 'close' : 'fullscreen'} size={14} />
            </button>
          </div>
        </div>
      </div>

      {data && data.pages.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-t border-hairline px-3 py-2">
          {data.pages.map((p) => (
            <button
              key={p.cid}
              type="button"
              aria-pressed={p.no === data.current_page}
              onClick={() => setPage(p.no)}
              title={p.title}
              className={`t press shrink-0 rounded-[6px] px-2 py-1 text-[12px] ${
                p.no === data.current_page
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)]'
              }`}
            >
              P{p.no} {p.title.slice(0, 12) || '分P'}
            </button>
          ))}
        </div>
      ) : null}


      {data ? (
        <div className="border-t border-hairline px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--text-2)]">
            <span className="font-medium text-[var(--text-1)]">{data.owner}</span>
            {data.owner_mid && followed !== null ? (
              <button
                type="button"
                aria-pressed={followed}
                onClick={() => {
                  const next = !followed
                  void ipc
                    .followSet(data.owner_mid!, next)
                    .then(() => {
                      setFollowed(next)
                      toastDone(next ? '已关注' : '已取消关注')
                    })
                    .catch(() => toastDone(next ? '关注失败' : '取消关注失败', '登录后再试'))
                }}
                className={`t press rounded-[4px] px-2 py-0.5 text-[12px] ${
                  followed
                    ? 'bg-[var(--panel-alt)] text-[var(--text-2)]'
                    : 'bg-[var(--accent)] text-white'
                }`}
              >
                {followed ? '已关注' : '关注'}
              </button>
            ) : null}
            <span className="num">{formatCount(data.stats.views)} 播放</span>
            <span className="num">{formatCount(data.stats.danmaku)} 弹幕</span>
            <span className="num">{formatCount(data.stats.likes)} 点赞</span>
            <span className="num">{formatCount(data.stats.coins)} 投币</span>
            <span className="num">{formatCount(data.stats.favorites)} 收藏</span>
            <span className="num">{formatCount(data.stats.shares)} 分享</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-pressed={liked}
              onClick={() => void toggleLike(track)}
              className={`t press flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] ${
                liked ? 'text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)]'
              }`}
            >
              <BiliThumb size={14} />
              {liked ? '已点赞' : '点赞'}
            </button>
            <button
              type="button"
              aria-pressed={coins > 0}
              onClick={() => {
                if (coins >= 2) {
                  toastDone('已经投过两枚', 'B 站上限 2 枚')
                  return
                }
                void addCoin(track, 1)
              }}
              className={`t press flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] ${
                coins > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)]'
              }`}
            >
              <BiliCoin size={14} />
              {coins > 0 ? `已投 ${coins} 枚` : '投币'}
            </button>
            <button
              type="button"
              aria-pressed={faved}
              onClick={() => void toggleFav(track)}
              className={`t press flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] ${
                faved ? 'text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)]'
              }`}
            >
              <BiliStar size={14} />
              {faved ? '已收藏' : '收藏'}
            </button>
            <button
              type="button"
              aria-pressed={saved}
              onClick={() => {
                const next = !saved
                void ipc
                  .watchLaterSet(track.key, next)
                  .then(() => {
                    setSaved(next)
                    toastDone(next ? '已加入稍后再看' : '已从稍后再看移除')
                  })
                  .catch(() =>
                    toastDone(next ? '加入稍后再看失败' : '移出稍后再看失败', '登录后再试'),
                  )
              }}
              className={`t press flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] ${
                saved
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)]'
              }`}
            >
              <Icon name="watchLater" size={13} />
              {saved ? '已加入稍后再看' : '稍后再看'}
            </button>
          </div>
          {data.desc ? (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-[1.5] text-[var(--text-3)]">
              {data.desc}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 border-t border-hairline">
        <CommentsPanel trackKey={track.key} />
      </div>
        </div>

        <aside className="hidden min-h-0 w-[340px] shrink-0 overflow-y-auto border-l border-hairline md:block">
          {related.length > 0 ? (
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-baseline gap-2">
                <h3 className="text-[12px] text-[var(--text-3)]">相关推荐</h3>
                <span className="num text-[11px] text-[var(--text-3)]">{related.length} 条</span>
              </div>
              <div className="flex flex-col gap-y-2">
                {related.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate({ kind: 'watch', track: item })}
                    title={item.title}
                    className="group flex items-start gap-2 text-left"
                  >
                    <span
                      className="relative w-[120px] shrink-0 overflow-hidden rounded-[4px]"
                      style={{ aspectRatio: '16 / 10' }}
                    >
                      <Cover cover={item.cover} title={item.title} className="h-full w-full" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-[12px] leading-[1.35] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                        {item.title}
                      </span>
                      <span className="num mt-0.5 block truncate text-[11px] text-[var(--text-3)]">
                        {item.artist}
                        {item.views ? ` · ${formatCount(item.views)}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

type ShakaVariant = { height: number; bandwidth: number | null; active?: boolean }

type ShakaPlayer = {
  load: (url: string) => Promise<void>
  destroy: () => Promise<void>
  getVariantTracks: () => ShakaVariant[]
  selectVariantTrack: (track: ShakaVariant, clearBuffer: boolean) => void
  addEventListener: (type: string, handler: (event: { detail?: unknown }) => void) => void
}

type ShakaGlobal = {
  Player: new (video: HTMLVideoElement) => ShakaPlayer
  polyfill?: { installAll?: () => void }
}
