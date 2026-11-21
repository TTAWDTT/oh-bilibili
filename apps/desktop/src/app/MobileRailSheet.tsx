import { useEffect, useRef } from 'react'
import { useAppStore } from './appStore'
import { NowPlayingRail } from '../features/player/NowPlayingRail'
import { Icon } from '../shared/ui/Icon'

/**
 * 移动端的歌词 / 队列面板。
 *
 * 桌面端它是右侧一栏；手机上右侧没有空间，收成从底部升起的抽屉，
 * 高度占九成屏幕，顶部留一个抓手与关闭键——和 B 站 App 的播放页抽屉一致。
 */
export function MobileRailSheet({ tab }: { tab: 'lyrics' | 'queue' }) {
  const closeRail = useAppStore((state) => state.closeRail)
  const toggleRail = useAppStore((state) => state.toggleRail)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeRail()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus()
    }
  }, [closeRail])

  return (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="播放详情">
      <button
        type="button"
        aria-label="关闭"
        tabIndex={-1}
        onClick={closeRail}
        className="absolute inset-0 cursor-default bg-black/35 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        className="absolute inset-x-0 bottom-0 top-[10%] flex flex-col overflow-hidden rounded-t-[14px] border-t border-[var(--line)] bg-[var(--panel)] shadow-[0_-12px_40px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
          <span aria-hidden className="h-1 w-9 rounded-full bg-[var(--line)]" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleRail('lyrics')}
              aria-pressed={tab === 'lyrics'}
              className={[
                't rounded-[4px] px-2 py-1 text-[13px]',
                tab === 'lyrics' ? 'text-[var(--accent)]' : 'text-[var(--text-3)]',
              ].join(' ')}
            >
              歌词
            </button>
            <button
              type="button"
              onClick={() => toggleRail('queue')}
              aria-pressed={tab === 'queue'}
              className={[
                't rounded-[4px] px-2 py-1 text-[13px]',
                tab === 'queue' ? 'text-[var(--accent)]' : 'text-[var(--text-3)]',
              ].join(' ')}
            >
              队列
            </button>
          </div>
          <button
            type="button"
            aria-label="关闭详情"
            onClick={closeRail}
            className="t flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:text-[var(--text-1)]"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <NowPlayingRail tab={tab} hideHeader />
        </div>
      </div>
    </div>
  )
}
