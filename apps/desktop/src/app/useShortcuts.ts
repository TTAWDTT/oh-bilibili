import { useEffect } from 'react'
import { usePlayerStore } from '../features/player/playerStore'
import { useDanmakuSettings } from '../features/player/danmakuSettings'
import { readPlayhead } from '../shared/lib/playhead'
import { watchFav } from '../features/watch/watchActions'
import { useAppStore } from './appStore'

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const NATIVE_ACTIVATION = new Set(['BUTTON', 'A'])

/**
 * 焦点元素自己会不会用空格：输入类往里打空格，按钮/链接由空格原生激活。
 * 只在入口分一次类，后面的全局快捷键按它决定让不让。
 */
function keyTarget(element: Element | null): 'text' | 'activation' | 'other' {
  if (!(element instanceof HTMLElement)) return 'other'
  if (TEXT_ENTRY.has(element.tagName) || element.isContentEditable || element.getAttribute('role') === 'textbox') {
    return 'text'
  }
  return NATIVE_ACTIVATION.has(element.tagName) ? 'activation' : 'other'
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
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
        (el) => el.getClientRects().length > 0,
      )
      const dialogOpen = dialogs.length > 0
      const modalOpen = dialogs.some((el) => el.getAttribute('aria-modal') === 'true')
      const target = keyTarget(document.activeElement)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        // 模态盖着整页时全局快捷键让路，焦点不能穿到遮罩后的搜索框。
        if (modalOpen) return
        event.preventDefault()
        useAppStore.getState().focusSearch()
        return
      }
      if (event.key === 'Escape') {
        // 搜索面板盖在内容上，Esc 先收它，再谈全屏与右栏。
        const app = useAppStore.getState()
        if (app.searchOpen) {
          app.closeSearch()
          return
        }
        if (app.stage) return
        // 弹窗自己在 Modal 里处理 Esc，这里只负责没有弹窗时的收尾：
        // 先退出全屏，再收右栏。
        if (!dialogOpen) {
          if (app.cinema) {
            app.setCinema(false)
            app.setOsFullscreen(false)
          }
          else app.closeRail()
        }
        return
      }
      if (dialogOpen || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (target === 'text') return

      const player = usePlayerStore.getState()
      if (event.code === 'Space') {
        // 焦点在按钮/链接上时，空格是原生激活，不能 preventDefault，也不能拿去播放。
        if (target === 'activation') return
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
      } else if (key === 'e' && useAppStore.getState().view.kind === 'watch') {
        // E 收藏，和收藏按钮同一个入口。
        event.preventDefault()
        watchFav()
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
