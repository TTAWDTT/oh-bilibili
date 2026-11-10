import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { QualityOption, Track, WatchView as WatchData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatTime } from '../../shared/lib/format'
import { DanmakuField, toDanmakuItems } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useDanmakuSettings } from '../player/danmakuSettings'
import { CommentsPanel } from './CommentsPanel'
import { useReactionStore } from '../reactions/reactionStore'
import { toastDone } from '../../app/notice'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'

/**
 * 观看页。
 *
 * 画面由 shaka 播 DASH，清单来自 Rust 侧合成的只含视频轨的 MPD。
 * 清单与分片都走本机代理，前端拿不到任何远端地址。
 *
 * 视频元素一直静音：声音归音频引擎，两处发声就是对不上。
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
  const [videoPlaying, setVideoPlaying] = useState(false)
  const danmakuOn = useDanmakuSettings((s) => s.enabled)
  const danmakuOpacity = useDanmakuSettings((s) => s.opacity)
  const danmakuSize = useDanmakuSettings((s) => s.size)
  const danmakuSpeed = useDanmakuSettings((s) => s.speed)

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

  // 取弹幕。时间轴跟视频走，不跟音频引擎。
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

  // 相关推荐。右栏只在「听」时出现，所以观看页要有自己的一份，
  // 否则看视频时完全没有相关推荐可点。
  useEffect(() => {
    let cancelled = false
    setRelated([])
    void ipc
      .related(track.key)
      .then((list) => {
        if (!cancelled) setRelated(list.slice(0, 10))
      })
      .catch(() => setRelated([]))
    return () => {
      cancelled = true
    }
  }, [track.key])

  // 弹幕只关心「在不在播」。位置由 DanmakuField 直接读元素，
  // 这样父组件不必为时间推进重渲染。
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = (): void => setVideoPlaying(!video.paused && !video.ended)
    sync()
    video.addEventListener('play', sync)
    video.addEventListener('pause', sync)
    video.addEventListener('ended', sync)
    return () => {
      video.removeEventListener('play', sync)
      video.removeEventListener('pause', sync)
      video.removeEventListener('ended', sync)
    }
  }, [data])

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
        if (cancelled) {
          await player.destroy()
          return
        }
        setReady(true)
        await video.play().catch(() => {
          // 自动播放被拒不算错，用户点一下即可
        })
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
            const at = videoRef.current ? Math.round(videoRef.current.currentTime * 1000) : 0
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

      <div className="relative min-h-0 flex-1 bg-black" style={{ flex: '0 0 auto', height: '52%' }}>
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-full w-full object-contain"
          aria-label="视频画面"
        />
        <DanmakuField
          items={danmaku}
          position={() => (videoRef.current ? Math.round(videoRef.current.currentTime * 1000) : 0)}
          playing={videoPlaying}
          enabled={danmakuOn}
          opacity={danmakuOpacity}
          size={danmakuSize}
          speed={danmakuSpeed}
          fade
        />
        {!ready && !error ? (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/70">
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
        <div className="flex flex-wrap items-center gap-1 border-t border-hairline px-3 py-2">
          <span className="mr-1 text-[12px] text-[var(--text-3)]">画质</span>
          {data.qualities.map((q) => (
            <button
              key={`${q.id}-${q.height}`}
              type="button"
              aria-pressed={activeId === q.id}
              onClick={() => pickQuality(q)}
              className={`t press rounded-[6px] px-2 py-1 text-[12px] ${
                activeId === q.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'hover:bg-[var(--panel-alt)] text-[var(--text-2)]'
              }`}
            >
              {q.label}
            </button>
          ))}
          <span className="ml-auto text-[12px] text-[var(--text-3)]">
            弹幕 {danmaku.length} 条
          </span>
        </div>
      ) : null}

      {data ? (
        <div className="border-t border-hairline px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--text-2)]">
            <span className="font-medium text-[var(--text-1)]">{data.owner}</span>
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
              <Icon name={liked ? 'heartFilled' : 'heart'} size={13} />
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
              <Icon name="coin" size={13} />
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
              <Icon name={faved ? 'bookmarkFilled' : 'bookmark'} size={13} />
              {faved ? '已收藏' : '收藏'}
            </button>
            <button
              type="button"
              onClick={() => {
                void ipc
                  .watchLaterSet(track.key, true)
                  .then(() => toastDone('已加入稍后再看'))
                  .catch(() => toastDone('加入稍后再看失败', '登录后再试'))
              }}
              className="t press flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)]"
            >
              <Icon name="watchLater" size={13} />
              稍后再看
            </button>
          </div>
          {data.desc ? (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-[1.5] text-[var(--text-3)]">
              {data.desc}
            </p>
          ) : null}
        </div>
      ) : null}

      {related.length > 0 ? (
        <div className="border-t border-hairline px-3 py-2">
          <h3 className="mb-1.5 text-[12px] text-[var(--text-3)]">相关推荐</h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {related.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate({ kind: 'watch', track: item })}
                title={item.title}
                className="group w-[148px] shrink-0 text-left"
              >
                <span className="relative block overflow-hidden rounded-[4px]" style={{ aspectRatio: '16 / 10' }}>
                  <Cover
                    cover={item.cover}
                    title={item.title}
                    className="h-full w-full"
                    glyphClassName="text-[22px] font-semibold text-white/80"
                  />
                </span>
                <span className="mt-1 line-clamp-2 block text-[12px] leading-[1.35] text-[var(--text-2)] group-hover:text-[var(--accent)]">
                  {item.title}
                </span>
                <span className="num mt-0.5 block text-[11px] text-[var(--text-3)]">{item.artist}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 border-t border-hairline">
        <CommentsPanel trackKey={track.key} />
      </div>
    </div>
  )
}

type ShakaVariant = { height: number; bandwidth: number | null }

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
