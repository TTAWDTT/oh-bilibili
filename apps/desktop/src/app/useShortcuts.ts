import { useEffect } from 'react'
import { usePlayerStore } from '../features/player/playerStore'
import { readPlayhead } from '../shared/lib/playhead'
import { useAppStore } from './appStore'

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 输入框、可编辑区与滑块自己消费按键，全局快捷键不能抢。 */
function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return TEXT_ENTRY.has(element.tagName) || element.isContentEditable || element.getAttribute('role') === 'textbox'
}

function seekBy(delta: number): void {
  const player = usePlayerStore.getState()
  const duration = player.snapshot?.duration_ms ?? 0
  if (!player.snapshot?.track) return
  const target = readPlayhead() + delta
  const upper = duration > 0 ? duration : target
  void player.seek(Math.min(upper, Math.max(0, target)))
}

/**
 * 全局快捷键：空格播放/暂停、←/→ 快退快进 5 秒、Esc 收栏、⌘K 搜歌。
 * 放在 window 上而不是某个组件里，这样焦点在页面任何角落都成立。
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const dialogOpen = document.querySelector('[role="dialog"]') !== null
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        useAppStore.getState().focusSearch()
        return
      }
      if (event.key === 'Escape') {
        // 弹窗自己在 Modal 里处理 Esc，这里只负责没有弹窗时的收尾：
        // 先退出全屏，再收右栏。
        if (!dialogOpen) {
          const app = useAppStore.getState()
          if (app.cinema) {
            app.setCinema(false)
            app.setOsFullscreen(false)
          }
          else app.closeRail()
        }
        return
      }
      if (dialogOpen || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTextEntry(document.activeElement)) return

      const player = usePlayerStore.getState()
      if (event.code === 'Space') {
        event.preventDefault()
        if (player.snapshot?.track) void player.toggle()
        return
      }
      // F 全屏、W 网页全屏，和 B 站播放器同一套键位。
      // 只在观看页有意义：其他页面没有可放大的画面。
      const key = event.key.toLowerCase()
      if ((key === 'f' || key === 'w') && useAppStore.getState().view.kind === 'watch') {
        event.preventDefault()
        const app = useAppStore.getState()
        if (key === 'f') {
          if (app.osFullscreen) {
            app.setCinema(false)
            app.setOsFullscreen(false)
          } else {
            app.setCinema(true)
            app.setOsFullscreen(true)
          }
        } else if (app.cinema && !app.osFullscreen) {
          app.setCinema(false)
        } else if (!app.cinema) {
          app.setCinema(true)
        }
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seekBy(-5_000)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seekBy(5_000)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
