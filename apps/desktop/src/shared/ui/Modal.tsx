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
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-[6px]"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal-panel relative w-full ${width} overflow-hidden rounded-3xl border border-white/12 bg-[#0a0a10]/94 shadow-[0_50px_140px_-30px_rgba(0,0,0,0.92)] outline-none`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-1 pt-6">
          <div>
            <h2 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-white/94">{title}</h2>
            {description ? (
              <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-white/42">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-2 text-white/45 transition hover:bg-white/10 hover:text-white/85"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="px-6 pb-6 pt-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
