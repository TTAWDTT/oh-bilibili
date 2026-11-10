import { currentMonitor, getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'

/** 可交互元素上起手不算拖窗口。 */
function isInteractive(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  return Boolean(el.closest('button, input, textarea, select, a, [role="button"]'))
}

/**
 * 自己实现的窗口拖动。
 *
 * 为什么不用 data-tauri-drag-region：它走 startDragging()，补了
 * core:window:allow-start-dragging 之后在这台机器上仍然纹丝不动。
 *
 * 几个踩过的坑：
 * - 位移用 PointerEvent.screenX/Y 算，这是屏幕坐标，窗口移动不会让它失效。
 * - 窗口位置与「是否最大化」要一起异步取；取到之前不移动，取到之后按累计位移落位。
 * - 监听挂在 document 上：窗口移动时指针可能瞬间离开顶栏，挂在元素上会断。
 * - 最大化时不许拖。setPosition 会把全屏窗口挪出屏幕，实测留下一个
 *   1920×1050 却停在 (120,130) 的怪状态。想移动请先点绿灯还原。
 */
export function useWindowDrag(): { onPointerDown: (event: React.PointerEvent) => void } {
  return {
    onPointerDown: (event) => {
      if (event.button !== 0) return
      if (isInteractive(event.target)) return

      const appWindow = getCurrentWindow()
      const startX = event.screenX
      const startY = event.screenY
      let winX: number | null = null
      let winY: number | null = null
      let scale = 1
      let maximized = true // 取到真实状态前先别动，避免在最大化窗口上误拖
      let moved = false
      let latestDx = 0
      let latestDy = 0

      const place = (): void => {
        if (winX === null || winY === null || maximized) return
        void appWindow
          .setPosition(
            new PhysicalPosition(Math.round(winX + latestDx), Math.round(winY + latestDy)),
          )
          .catch(() => {})
      }

      void (async () => {
        try {
          const p = await appWindow.outerPosition()
          const s = await appWindow.scaleFactor()
          const monitor = await currentMonitor().catch(() => null)
          const zoomed = await appWindow.isMaximized().catch(() => false)
          const outer = await appWindow.outerSize()
          winX = p.x
          winY = p.y
          scale = s || 1
          // isMaximized 在 macOS 的「缩放」状态下不一定为真，再用尺寸兜一层：
          // 占满整块屏幕的宽度就算最大化。
          const fillsWidth = monitor ? outer.width >= monitor.size.width - 4 : false
          maximized = zoomed || fillsWidth
          if (moved) place()
        } catch {
          // 拿不到窗口信息就放弃这次拖动，不阻塞点击
        }
      })()

      const onMove = (ev: PointerEvent): void => {
        latestDx = (ev.screenX - startX) * scale
        latestDy = (ev.screenY - startY) * scale
        if (!moved && Math.abs(latestDx) < 3 && Math.abs(latestDy) < 3) return
        moved = true
        place()
      }

      const onUp = (): void => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
  }
}
