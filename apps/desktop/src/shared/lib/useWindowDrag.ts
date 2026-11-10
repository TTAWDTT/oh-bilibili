import { useRef } from 'react'
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'

/**
 * 自己实现的窗口拖动。
 *
 * 为什么不用 data-tauri-drag-region：它走 startDragging()，在这个环境里
 * 实测按下去窗口纹丝不动（权限已开、命中目标也对）。改成监听指针事件、
 * 按屏幕坐标算位移、直接 setPosition——每一步都可在测试里观察。
 *
 * 交互细节：
 * - 从按钮、输入框等可交互元素上起手不算拖窗口
 * - 双击（没移动过）就最大化/还原
 */
export function useWindowDrag(): {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onDoubleClick: () => void
} {
  const drag = useRef<{
    startX: number
    startY: number
    winX: number
    winY: number
    scale: number
    moved: boolean
    pointerId: number
  } | null>(null)

  return {
    onPointerDown: (event) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      // 可交互元素要自己处理点击，不能拿来拖窗口
      if (target.closest('button, input, textarea, select, a, [role="button"]')) return
      const win = getCurrentWindow()
      void (async () => {
        try {
          const pos = await win.outerPosition()
          const wx = pos.x
          const wy = pos.y
          const scale = await win.scaleFactor()
          drag.current = {
            startX: event.screenX,
            startY: event.screenY,
            winX: wx,
            winY: wy,
            scale,
            moved: false,
            pointerId: event.pointerId,
          }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        } catch {
          // 拿不到窗口信息就不拖，别把点击吃掉
          drag.current = null
        }
      })()
    },
    onPointerMove: (event) => {
      const d = drag.current
      if (!d) return
      const dx = (event.screenX - d.startX) * d.scale
      const dy = (event.screenY - d.startY) * d.scale
      if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      d.moved = true
      void getCurrentWindow()
        .setPosition(new PhysicalPosition(Math.round(d.winX + dx), Math.round(d.winY + dy)))
        .catch(() => {})
    },
    onPointerUp: (event) => {
      const d = drag.current
      drag.current = null
      if (!d) return
      try {
        event.currentTarget.releasePointerCapture?.(d.pointerId)
      } catch {
        // 指针捕获可能已经被系统释放，忽略
      }
      // 移动过就不再当成双击
      if (d.moved) event.stopPropagation()
    },
    onDoubleClick: () => {
      void getCurrentWindow().toggleMaximize().catch(() => {})
    },
  }
}
