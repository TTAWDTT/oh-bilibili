import { useRef } from 'react'

/**
 * 横向滑动检测。手机上没有「上一首 / 下一首」按钮的地方就靠它。
 *
 * 三个条件才算一次滑动：起点到终点的横向距离够长、横向明显大于纵向
 * （否则会和纵向滚动打架）、并且不是从可交互元素上开始的。
 */
export function useSwipe({
  onLeft,
  onRight,
  threshold = 60,
}: {
  onLeft?: () => void
  onRight?: () => void
  threshold?: number
}): {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
} {
  const start = useRef<{ x: number; y: number } | null>(null)

  return {
    onPointerDown: (event) => {
      // 从按钮、输入框起手是要点它们，不是滑动
      const target = event.target as HTMLElement
      if (target.closest('button, input, textarea, a, [role="button"], [role="slider"]')) {
        start.current = null
        return
      }
      start.current = { x: event.clientX, y: event.clientY }
    },
    onPointerUp: (event) => {
      const from = start.current
      start.current = null
      if (!from) return
      const dx = event.clientX - from.x
      const dy = event.clientY - from.y
      if (Math.abs(dx) < threshold) return
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return
      if (dx < 0) onLeft?.()
      else onRight?.()
    },
  }
}
