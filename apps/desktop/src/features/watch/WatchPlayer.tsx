import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { QualityOption, Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { DanmakuField } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useDanmakuSettings } from '../player/danmakuSettings'
import { usePlayerStore } from '../player/playerStore'
import { VolumeControl } from '../player/VolumeControl'
import { Icon } from '../../shared/ui/Icon'
import type { ShakaGlobal, ShakaPlayer } from './shaka'

/** 观看页的倍速档位，和 B 站播放器一致。 */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const
/** 画面与声音允许的偏差。超过就拉回，低于就让它自己跑，避免每帧 seek。 */
const DRIFT_MS = 400

/**
 * 观看页的播放器：画面、弹幕层、悬浮控制条。
 *
 * 声音只有一个发声者，就是音频引擎。视频元素始终静音，只负责画面，
 * 并且跟着引擎的时钟走：暂停、拖动、换速都以引擎为准。
 * 清单与分片都走本机代理，前端拿不到任何远端地址。
 */
export function WatchPlayer({
  track,
  data,
  danmaku,
  onDanmakuSent,
}: {
  track: Track
  data: WatchData
  danmaku: DanmakuItem[]
  onDanmakuSent: (item: DanmakuItem) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<ShakaPlayer | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [controls, setControls] = useState(true)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [now, setNow] = useState(0)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [cinema, setCinema] = useState(false)
  const [playing, setPlaying] = useState(false)

  const speed = usePlayerStore((state) => state.snapshot?.speed ?? 1)
  const setSpeed = usePlayerStore((state) => state.setSpeed)
  const danmakuOn = useDanmakuSettings((s) => s.enabled)
  const danmakuOpacity = useDanmakuSettings((s) => s.opacity)
  const danmakuSize = useDanmakuSettings((s) => s.size)
  const danmakuSpeed = useDanmakuSettings((s) => s.speed)
  const setDanmakuEnabled = useDanmakuSettings((s) => s.setEnabled)

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
    const duration = data.duration_ms
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
    const at = Math.round(readPlayhead())
    try {
      await ipc.danmakuSend(track.key, text, at)
      setDraft('')
      onDanmakuSent({ at, text, color: 'var(--text-1)' })
      poke()
    } catch {
      // 发不出去就留着草稿，不假装成功
    } finally {
      setSending(false)
    }
  }

  // 画面跟随引擎：引擎在放就放，引擎暂停就停，偏差超了拉回来。
  // 只看引擎的状态，不看视频自己的 play/pause，避免两个真值打架。
  useEffect(() => {
    if (!ready) return
    const timer = window.setInterval(() => {
      const v = videoRef.current
      if (!v) return
      const snap = usePlayerStore.getState().snapshot
      // 引擎在放别人的时候，画面不能被它拖着走。
      const sameTrack = snap?.track?.key === track.key
      const enginePlaying = sameTrack && snap?.phase === 'playing'
      setPlaying(enginePlaying)
      if (!sameTrack || !enginePlaying) {
        if (!v.paused) v.pause()
        return
      }
      if (v.paused) void v.play().catch(() => {})
      const head = readPlayhead()
      if (Math.abs(v.currentTime * 1000 - head) > DRIFT_MS) v.currentTime = head / 1000
      if (v.playbackRate !== speed) v.playbackRate = speed
    }, 250)
    return () => window.clearInterval(timer)
  }, [ready, track.key, speed])

  // 挂载 shaka
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
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
          const detail = event.detail as { handled?: boolean } | undefined
          if (detail?.handled) return
          setError(`播放失败：${String(event.detail ?? '未知错误')}`)
        })
        video.muted = true
        video.volume = 0
        await player.load(data.manifest_url)
        // shaka 会自动选一档。把当前档位映射回 B 站的画质 id，
        // 否则按钮上只能显示兜底文案，用户不知道现在是多少。
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

  const duration = data.duration_ms || track.duration_ms || 0
  const percent = Math.min(100, (now / Math.max(1, duration)) * 100)

  return (
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
          常驻一条控制条会把画面挤小，视频网站都不这么做。 */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2 pt-10 text-white transition-opacity duration-200 ${
          controls || !playing ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* 窄屏把发弹幕单独放一行：控制条一行塞不下输入框，挤压后会与画面字幕糊在一起。 */}
        <div className="mb-1.5 flex items-center gap-2 md:hidden">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void sendDanmaku()
            }}
            placeholder="发条弹幕"
            aria-label="发弹幕"
            className="h-7 min-w-0 flex-1 rounded-[4px] bg-black/45 px-2 text-[12px] text-white placeholder-white/60 outline-none focus:bg-black/60"
          />
          <button
            type="button"
            onClick={() => void sendDanmaku()}
            disabled={!draft.trim() || sending}
            className="t press h-7 shrink-0 rounded-[4px] bg-[var(--accent)] px-2 text-[12px] text-white disabled:opacity-40"
          >
            发送
          </button>
        </div>

        <div
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          tabIndex={0}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            seekTo((event.clientX - box.left) / box.width)
          }}
          // 标成 slider 就必须能被键盘操作：Home/End 跳到两端，
          // 方向键按 5 秒走。缺这一段，读屏和纯键盘用户完全拖不动进度。
          onKeyDown={(event) => {
            if (!data.duration_ms) return
            const step = event.shiftKey ? 30_000 : 5_000
            const at = readPlayhead()
            const keys: Record<string, number | undefined> = {
              Home: 0,
              // 正好落在 duration 上会被解码器当成越界忽略，留 1.5 秒。
              End: Math.max(0, 1 - 1500 / data.duration_ms),
              ArrowLeft: (at - step) / data.duration_ms,
              ArrowDown: (at - step) / data.duration_ms,
              ArrowRight: (at + step) / data.duration_ms,
              ArrowUp: (at + step) / data.duration_ms,
            }
            const target = keys[event.key]
            if (target === undefined) return
            event.preventDefault()
            seekTo(target)
          }}
          className="group relative mb-1.5 h-3 cursor-pointer"
        >
          <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-white/25" />
          <span
            className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--accent)]"
            style={{ width: `${percent}%` }}
          />
          <span
            className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            style={{ left: `${percent}%` }}
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
            {formatTime(now)} / {formatTime(duration)}
          </span>

          <div className="min-w-0 flex-1" />

          <div className="hidden items-center gap-2 md:flex">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendDanmaku()
              }}
              placeholder="发条弹幕"
              aria-label="发弹幕"
              className="h-7 w-[150px] shrink-0 rounded-[4px] bg-black/45 px-2 text-[12px] text-white placeholder-white/60 outline-none focus:bg-black/60"
            />
            <button
              type="button"
              onClick={() => void sendDanmaku()}
              disabled={!draft.trim() || sending}
              className="t press h-7 shrink-0 rounded-[4px] bg-[var(--accent)] px-2 text-[12px] text-white disabled:opacity-40"
            >
              发送
            </button>
          </div>

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

          <button
            type="button"
            onClick={() => {
              const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number])
              void setSpeed(SPEEDS[(i + 1) % SPEEDS.length] ?? 1)
            }}
            title="播放倍速"
            aria-label={`播放倍速 ${speed}x`}
            className="t press num hidden h-7 shrink-0 rounded-[4px] px-2 text-[12px] hover:bg-white/15 md:block"
          >
            {speed}x
          </button>

          {/* 音量与倍速在窄屏交给系统：手机上调的是系统音量，不是应用音量。 */}
          <span
            className="hidden shrink-0 items-center md:flex"
            style={{ ['--text-2' as string]: 'rgb(255 255 255 / 0.85)' }}
          >
            <VolumeControl />
          </span>

          {data.qualities.length > 0 ? (
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
  )
}
