import { useEffect, useRef } from 'react'
import { subscribeLevel } from '../../shared/lib/level'
import { useIsPlaying } from './playerStore'

const BAR_W = 3
const GAP = 2

/**
 * 常驻音频波形带。
 *
 * 静止时是一道缓慢流动的正弦，播放时叠上真实响度。它的作用是让界面
 * 在没有交互的时候也「在动」——纯静态布局看起来像截图，不像播放器。
 *
 * 用 canvas 而不是 DOM：一条带子上有上百根竖线，DOM 会拖垮列表滚动。
 */
export function WaveRibbon() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const levelRef = useRef(0)
  const playing = useIsPlaying()

  useEffect(() => subscribeLevel((v) => {
    levelRef.current = v
  }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let smooth = 0
    let t = 0

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const target = playing ? levelRef.current : 0.12
      smooth = smooth + (target - smooth) * 0.08
      t += 0.02

      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      ctx.strokeStyle = color || '#d9a15b'
      ctx.lineCap = 'round'
      ctx.lineWidth = BAR_W

      const count = Math.max(8, Math.floor(w / (BAR_W + GAP)))
      for (let i = 0; i < count; i += 1) {
        const p = i / count
        // 三条不同频率的正弦叠出「像音频」的不规则感，而不是一条平滑波浪
        const wave =
          Math.sin(p * 22 + t * 2.1) * 0.5 +
          Math.sin(p * 7 - t * 1.3) * 0.3 +
          Math.sin(p * 41 + t * 3.4) * 0.2
        const envelope = Math.sin(p * Math.PI)
        const amp = (0.1 + Math.abs(wave) * (0.35 + smooth * 2.2)) * envelope
        const half = Math.max(1, amp * (h / 2))
        const x = i * (BAR_W + GAP) + BAR_W / 2
        ctx.globalAlpha = 0.28 + Math.abs(wave) * 0.5
        ctx.beginPath()
        ctx.moveTo(x, h / 2 - half)
        ctx.lineTo(x, h / 2 + half)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return <canvas ref={canvasRef} aria-hidden className="h-5 w-full" />
}
