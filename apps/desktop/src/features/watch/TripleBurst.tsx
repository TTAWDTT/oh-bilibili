import type React from 'react'
import { useEffect, useState } from 'react'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'

/** 与 ui.css 的 triple-* 时间轴对齐：动画 1180ms 走完，这里再兜一层卸载。 */
const TOTAL_MS = 1200

const ICONS = [
  { label: '点赞', Icon: BiliThumb, tone: 'text-[var(--accent)]' },
  { label: '投币', Icon: BiliCoin, tone: 'text-[var(--warn)]' },
  { label: '收藏', Icon: BiliStar, tone: 'text-[var(--accent)]' },
] as const

/**
 * 长按点赞成功后的整屏庆祝。只负责情绪，说明留给 toast。
 *
 * 光环先闪，三枚图标依次弹出、再收拢淡出，播完自己卸载；卸载靠计时器而不是 animationend，
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
      className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-white/55 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-5">
        <span className="triple-title text-[17px] font-semibold tracking-[0.2em] text-[var(--accent)] [text-shadow:0_1px_10px_rgba(255,255,255,0.9)]">
          一键三连
        </span>
        <div className="relative">
          <span className="triple-ring absolute inset-0 m-auto h-56 w-56 rounded-full border-[3px] border-[var(--accent)] opacity-0" />
          <div className="relative flex items-center justify-center gap-16">
            {ICONS.map(({ label, Icon, tone }, i) => (
              <div
                key={label}
                className="triple-cell flex w-24 flex-col items-center gap-2"
                style={{ '--i': i } as React.CSSProperties}
              >
                <span className={`triple-pop ${tone}`}>
                  <Icon size={96} />
                </span>
                <span className="triple-label text-[13px] leading-none text-[var(--text-1)]">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
