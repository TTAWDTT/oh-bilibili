import { useEffect, useState } from 'react'
import { usePlayerStore } from '../features/player/playerStore'
import { useDanmakuSettings } from '../features/player/danmakuSettings'
import * as ipc from '../shared/lib/ipc'

/**
 * 全局弹幕带。播放时在当前曲目的真实弹幕里取几条，从右向左飘过顶部。
 *
 * 弹幕是 B 站最基础的语言。它不该只存在于播放页——B 站首页的视频预览、
 * 列表页的悬停预览里都有弹幕在动，这是「活着」的来源。
 *
 * 数据是真的：取当前曲目 cid 的弹幕接口，不是造的词库。
 */
export function DanmakuStrip() {
  const trackKey = usePlayerStore((state) => state.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((state) => state.snapshot?.phase === 'playing')
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const speed = useDanmakuSettings((s) => s.speed)
  const [lines, setLines] = useState<[string, string][]>([])

  useEffect(() => {
    if (!trackKey) {
      setLines([])
      return
    }
    let cancelled = false
    void ipc
      .danmakuColored(trackKey)
      .then((list) => {
        if (cancelled) return
        // B 站默认白字（0xFFFFFF），在浅色底上改用深色；其余彩色照原样用。
        setLines(
          list.slice(0, 10).map(([, text, rgb]) => {
            const hex = `#${rgb.toString(16).padStart(6, '0')}`
            return [text, rgb === 0xffffff ? 'var(--text-1)' : hex] as [string, string]
          }),
        )
      })
      .catch(() => setLines([]))
    return () => {
      cancelled = true
    }
  }, [trackKey])

  if (!enabled || !playing || lines.length === 0) return null

  return (
    <div className="pointer-events-none relative h-6 shrink-0 overflow-hidden border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--bili-pink)_5%,white)]" aria-hidden>
      {lines.map(([text, color], i) => (
        <span
          key={`${i}-${text}`}
          className="bili-strip-item absolute whitespace-nowrap rounded-[3px] px-1.5 text-[14px]"
          style={{
            color,
            top: `${(i % 2) * 11}px`,
            animationDuration: `${(14 + (i % 4) * 3) / speed}s`,
            animationDelay: `${i * 1.6}s`,
            opacity: opacity * 0.85,
            background: 'color-mix(in oklab, var(--bili-pink) 10%, white)',
          }}
        >
          {text}
        </span>
      ))}
    </div>
  )
}
