import { useMemo } from 'react'
import type { DanmakuItem } from './DanmakuField'
import { formatTime } from '../../shared/lib/format'

const BUCKETS = 120
const MIN_BAR_PX = 2
const MAX_BAR_PX = 8

/**
 * 柱高按 sqrt(count/max) 压：热门片段常比普通片段多一个数量级，
 * 线性映射下其余柱子会全贴底，看不出分布。
 */
export function DanmakuBeats({
  items,
  durationMs,
  onSeek,
}: {
  items: DanmakuItem[]
  durationMs: number
  /** 点某根热度柱直接跳到那个时段。不传就只是装饰。 */
  onSeek?: ((atMs: number) => void) | undefined
}) {
  const bars = useMemo(() => {
    if (durationMs <= 0 || items.length === 0) return null
    const counts = new Array<number>(BUCKETS).fill(0)
    for (const item of items) {
      const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor((item.at / durationMs) * BUCKETS)))
      counts[bucket] = (counts[bucket] ?? 0) + 1
    }
    const max = counts.reduce((peak, count) => Math.max(peak, count), 0)
    if (max === 0) return null
    return counts.map((count) => {
      if (count === 0) return { height: 0, opacity: 0 }
      const ratio = Math.sqrt(count / max)
      return {
        height: MIN_BAR_PX + (MAX_BAR_PX - MIN_BAR_PX) * ratio,
        opacity: 0.3 + 0.65 * ratio,
      }
    })
  }, [items, durationMs])

  if (!bars) return null

  const seekable = typeof onSeek === 'function'
  const bucketMs = durationMs / BUCKETS
  return (
    <div
      aria-hidden={!seekable}
      className={`absolute inset-x-0 -top-[13px] flex h-2 items-end gap-px ${
        seekable ? '' : 'pointer-events-none'
      }`}
    >
      {bars.map((bar, i) => (
        <span
          key={i}
          role={seekable && bar.height > 0 ? 'button' : undefined}
          title={
            seekable && bar.height > 0
              ? `${formatTime(i * bucketMs)} · 高能`
              : undefined
          }
          onClick={
            seekable && bar.height > 0
              ? (event) => {
                  // 不拦冒泡的话，进度条自己的 onClick 会用 clientX=0 把位置算回 0。
                  event.stopPropagation()
                  onSeek((i + 0.5) * bucketMs)
                }
              : undefined
          }
          className={`flex-1 rounded-[1px] bg-[var(--accent)] ${
            seekable && bar.height > 0 ? 'cursor-pointer hover:brightness-125' : ''
          }`}
          style={bar}
        />
      ))}
    </div>
  )
}
