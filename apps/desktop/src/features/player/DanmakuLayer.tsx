import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'

/**
 * 弹幕层。取这条视频的真实弹幕，按固定节奏从右向左飘过。
 *
 * 这一层是 B 站的文化标识，不是装饰：文本来自视频本身。
 * 只取前 60 条，避免把接口当弹幕池用。
 */
export function DanmakuLayer({ trackKey, playing }: { trackKey: string; playing: boolean }) {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void ipc
      .danmaku(trackKey)
      .then((list) => {
        if (!cancelled) setLines(list)
      })
      .catch(() => setLines([]))
    return () => {
      cancelled = true
    }
  }, [trackKey])

  if (lines.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {lines.slice(0, 18).map((text, i) => (
        <span
          key={`${i}-${text}`}
          className="danmaku absolute whitespace-nowrap text-[13px] text-white"
          style={{
            top: `${8 + (i * 100) / Math.max(1, Math.min(lines.length, 18))}%`,
            animationDuration: `${11 + (i % 5) * 2}s`,
            animationDelay: `${i * 0.9}s`,
            animationPlayState: playing ? 'running' : 'paused',
          }}
        >
          {text}
        </span>
      ))}
    </div>
  )
}
