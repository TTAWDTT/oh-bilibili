import { useEffect } from 'react'
import { usePlayerStore } from '../features/player/playerStore'
import { useDanmakuSettings } from '../features/player/danmakuSettings'
import { readPlayhead } from '../shared/lib/playhead'
import { useAppStore } from './appStore'

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 输入框、可编辑区与滑块自己消费按键，全局快捷键不能抢。 */
function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return TEXT_ENTRY.has(element.tagName) || element.isContentEditable || element.getAttribute('role') === 'textbox'
}

/** 静音前的音量：按 M 恢复时用它，避免恢复成 0。 */
let lastVolume = 0.72

function seekBy(delta: number): void {
  const player = usePlayerStore.getState()
  const duration = player.snapshot?.duration_ms ?? 0
  if (!player.snapshot?.track) return
  const target = readPlayhead() + delta
  const upper = duration > 0 ? duration : target
  void player.seek(Math.min(upper, Math.max(0, target)))
}

/**
 * 全局快捷键：空格播放/暂停、←/→ 快退快进 5 秒、↑/↓ 音量、D 弹幕、M 静音、
 * F/W 全屏、Esc 收栏、⌘K 搜歌。
 * 放在 window 上而不是某个组件里，这样焦点在页面任何角落都成立。
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 只看真正显示出来的弹窗：移动端右栏一直挂在 DOM 里（md:hidden），
      // 按 querySelector 算的话，只要在播放（右栏存在）快捷键就全废。
      // 用 getClientRects 判断可见：弹窗是 position: fixed，offsetParent 恒为 null，
      // 按 offsetParent 判会把「正开着弹窗」当成没有弹窗。
      const dialogOpen = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
        (el) => el.getClientRects().length > 0,
      )
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
      } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && player.snapshot?.track) {
        // 音量跟 B 站播放器一致：上下键各 5%。
        event.preventDefault()
        const step = event.key === 'ArrowUp' ? 0.05 : -0.05
        void player.setVolume(Math.min(1, Math.max(0, (player.snapshot.volume ?? 0) + step)))
      } else if (key === 'd') {
        // D 开关弹幕，B 站播放器的默认键位。
        event.preventDefault()
        const danmaku = useDanmakuSettings.getState()
        danmaku.setEnabled(!danmaku.enabled)
      } else if (key === 'm' && player.snapshot?.track) {
        // M 静音；再按一次回到静音前的音量。
        event.preventDefault()
        const current = player.snapshot.volume ?? 0
        if (current > 0.001) {
          lastVolume = current
          void player.setVolume(0)
        } else {
          void player.setVolume(lastVolume)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
