import type React from 'react'
import { useEffect, useState } from 'react'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'

/** 与 ui.css 的 triple-* 时间轴对齐：动画 1180ms 走完，这里再兜一层卸载。 */
const TOTAL_MS = 1200

const ICONS = [
  { label: '点赞', Icon: BiliThumb, tone: 'text-[var(--bili-pink)]' },
  { label: '投币', Icon: BiliCoin, tone: 'text-[var(--warn)]' },
  { label: '收藏', Icon: BiliStar, tone: 'text-[var(--accent)]' },
] as const

/**
 * 长按点赞成功后的整屏庆祝。只负责情绪，说明留给 toast。
 *
 * 三枚图标依次弹出、再收拢淡出，播完自己卸载；卸载靠计时器而不是 animationend，
 * 因为三枚各有各的延迟，等事件反而要先知道谁是最后一枚。
 * 连点时 run 变了而播放状态没变，所以外层 div 挂 key=run：换掉 DOM 才能让动画从头播。
 */
export function TripleBurst({ run }: { run: number }) {
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (run === 0) return
    setPlaying(true)
    const timer = window.setTimeout(() => setPlaying(false), TOTAL_MS)
    return () => window.clearTimeout(timer)
  }, [run])

  if (!playing) return null

  return (
    <div
      key={run}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center gap-12 bg-white/40"
    >
      {ICONS.map(({ label, Icon, tone }, i) => (
        <div
          key={label}
          className="triple-cell flex w-[80px] flex-col items-center gap-2"
          style={{ '--i': i } as React.CSSProperties}
        >
          <span className={`triple-pop ${tone}`}>
            <Icon size={72} />
          </span>
          <span className="triple-label text-[12px] leading-none text-[var(--text-1)]">{label}</span>
        </div>
      ))}
    </div>
  )
}
