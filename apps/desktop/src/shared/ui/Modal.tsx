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
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
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
        className="t absolute inset-0 cursor-default bg-black/65 hover:bg-black/70 backdrop-blur-[6px]"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal-panel relative w-full ${width} border border-white/14 bg-[#0b0b10]`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
          <div>
            <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-white/94">{title}</h2>
            {description ? <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-white/44">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭（Esc）"
            className="t press rounded-[4px] p-2 text-white/45 hover:text-white"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
