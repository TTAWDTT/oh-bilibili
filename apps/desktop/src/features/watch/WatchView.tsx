import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { QualityOption, Track, WatchView as WatchData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatTime } from '../../shared/lib/format'
import { DanmakuField, toDanmakuItems } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useDanmakuSettings } from '../player/danmakuSettings'
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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<ShakaPlayer | null>(null)
  const [data, setData] = useState<WatchData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([])
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
        const next = await ipc.watchOpen(track.key)
        if (!cancelled) setData(next)
      } catch (e) {
        if (!cancelled) setError(toWireError(e).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [track.key])

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
          onClick={() => navigate({ kind: 'search' })}
          className="t press flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[var(--panel-alt)]"
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium">{track.title}</h2>
        <span className="num shrink-0 text-[12px] text-[var(--text-3)]">
          {track.duration_ms ? formatTime(track.duration_ms) : '—'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 bg-black">
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
