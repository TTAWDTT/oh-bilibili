import { useEffect, useRef } from 'react'
import { subscribeLevel } from '../../shared/lib/level'
import { usePlayerStore } from './playerStore'

const BARS = 14

/**
 * 频谱条。高度来自 Rust 声卡回调算出的真实 RMS，不是随机数。
 *
 * 每根柱子按相位错开：同一时刻只有一部分柱子在高位，看起来才像频谱而不是整条一起跳。
 * 直接改 style.height 而不是走 state，10Hz 的重渲染会拖慢列表滚动。
 */
export function LevelBars() {
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  const playing = usePlayerStore((state) => state.snapshot?.phase === 'playing')

  useEffect(() => {
    let smooth = 0
    let raf = 0
    const unsubscribe = subscribeLevel((level) => {
      // 上升快、回落慢，符合人耳对响度的感知。
      smooth = level > smooth ? level : smooth * 0.86 + level * 0.14
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        refs.current.forEach((el, i) => {
          if (!el) return
          const phase = Math.sin((i / BARS) * Math.PI)
          const wobble = 0.6 + 0.4 * Math.sin(i * 1.7 + smooth * 9)
          const h = Math.max(2, Math.round(smooth * 22 * phase * wobble))
          el.style.height = `${h}px`
        })
      })
    })
    return () => {
      unsubscribe()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="flex h-6 items-center gap-[2px]" aria-hidden data-playing={playing}>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="w-[2px] origin-center rounded-full bg-[var(--accent)] transition-[height] duration-100"
          style={{ height: 2, opacity: playing ? 0.9 : 0.25 }}
        />
      ))}
    </div>
  )
}
