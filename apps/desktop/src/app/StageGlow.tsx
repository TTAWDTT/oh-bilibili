import { useEffect, useRef } from 'react'
import { subscribeLevel } from '../shared/lib/level'
import { usePlayerStore } from '../features/player/playerStore'

/**
 * 背景呼吸。整页底下压一层暖色光晕，强度跟着真实响度走。
 *
 * 和频谱条共用同一条 level 通道，但这里改的是 opacity 与 scale，
 * 走合成层，不触发重排，所以铺满整页也不掉帧。
 */
export function StageGlow() {
  const ref = useRef<HTMLDivElement | null>(null)
  const playing = usePlayerStore((state) => state.snapshot?.phase === 'playing')

  useEffect(() => {
    let smooth = 0
    let raf = 0
    const unsubscribe = subscribeLevel((level) => {
      smooth = level > smooth ? level : smooth * 0.92 + level * 0.08
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = ref.current
        if (!el) return
        const strength = Math.min(1, smooth * 3.2)
        el.style.opacity = String(0.02 + strength * 0.06)
        el.style.transform = `scale(${1 + strength * 0.06})`
      })
    })
    return () => {
      unsubscribe()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {/* 常驻层：极慢漂移的两团色斑。不播放时界面也在呼吸，这是「活着」的底子。 */}
      <div className="ambient-drift-a absolute -left-[10%] top-[-20%] h-[70%] w-[55%] rounded-full" />
      <div className="ambient-drift-b absolute -right-[8%] bottom-[-25%] h-[65%] w-[50%] rounded-full" />
      <div
        ref={ref}
        className="absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-300"
        style={{
          opacity: playing ? 0.05 : 0.015,
          background:
            'radial-gradient(circle at 50% 42%, color-mix(in oklab, var(--accent) 62%, transparent) 0%, transparent 58%)',
          filter: 'blur(60px)',
        }}
      />
    </div>
  )
}
