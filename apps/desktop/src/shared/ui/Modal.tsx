import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

type ModalProps = {
  open: boolean
  title: string
  description: string | null
  onClose: () => void
  children: ReactNode
  width?: string
}

export function Modal({ open, title, description, onClose, children, width = 'max-w-md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    // 记住打开前的焦点，关闭后还回去，键盘用户不会「跳到页面顶部」
    const previous = document.activeElement as HTMLElement | null

    const focusables = (): HTMLElement[] => {
      const panel = panelRef.current
      if (!panel) return []
      return [...panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // 焦点陷阱：Tab 走到两端就绕回，不会跑到弹窗后面的页面上
      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = panelRef.current?.contains(active) ?? false
      if (!inside) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="关闭遮罩"
        tabIndex={-1}
        onClick={onClose}
        className="t absolute inset-0 cursor-default bg-black/35 backdrop-blur-[3px]"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal-panel relative w-full ${width} rounded-[10px] border border-[var(--line)] bg-[var(--panel)] shadow-[0_18px_50px_-16px_rgba(0,0,0,0.35)]`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-3 py-5">
          <div>
            <h2 className="text-[18px] font-semibold text-[var(--text-1)]">{title}</h2>
            {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--text-3)]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭（Esc）"
            className="t press -mr-1 rounded-[4px] p-1.5 text-[var(--text-3)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="px-3 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
