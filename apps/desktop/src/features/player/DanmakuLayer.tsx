import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { useDanmakuSettings } from './danmakuSettings'

/**
 * 弹幕层。取这条视频的真实弹幕，按固定节奏从右向左飘过。
 *
 * 这一层是 B 站的文化标识，不是装饰：文本来自视频本身。
 * 只取前 60 条，避免把接口当弹幕池用。
 */
export function DanmakuLayer({ trackKey, playing }: { trackKey: string; playing: boolean }) {
  const [lines, setLines] = useState<string[]>([])
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const size = useDanmakuSettings((s) => s.size)
  const speed = useDanmakuSettings((s) => s.speed)

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

  if (!enabled || lines.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {lines.slice(0, 18).map((text, i) => (
        <span
          key={`${i}-${text}`}
          className="danmaku absolute whitespace-nowrap text-[14px]"
          style={{
            // 只占上半部：下半部是标题和歌词，弹幕压上去会读不清
            top: `${5 + (i * 46) / Math.max(1, Math.min(lines.length, 12))}%`,
            // 速度越大，动画时长越短
            animationDuration: `${(11 + (i % 5) * 2) / speed}s`,
            // 舞台是浅色底，白字会看不见；用深色 + 白色描边保证在任何封面上都读得清
            color: 'var(--text-1)',
            textShadow: '0 0 3px #fff, 0 0 6px #fff, 0 0 1px #fff',
            opacity,
            fontSize: `${size}px`,
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
