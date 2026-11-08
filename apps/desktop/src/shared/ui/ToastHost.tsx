import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Toast, ToastTone } from '../../app/appStore'
import { useAppStore } from '../../app/appStore'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const TONE: Record<ToastTone, { icon: IconName; tint: string; edge: string }> = {
  error: { icon: 'alert', tint: 'text-[#ff6b8a]', edge: 'border-[#ff6b8a]/22' },
  warn: { icon: 'alert', tint: 'text-[#ffc46b]', edge: 'border-[#ffc46b]/22' },
  info: { icon: 'info', tint: 'text-[#7bf0ff]', edge: 'border-[#7bf0ff]/22' },
  success: { icon: 'check', tint: 'text-[#7bf0a0]', edge: 'border-[#7bf0a0]/22' },
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 5200)
    return () => window.clearTimeout(timer)
  }, [toast.id, onDismiss])

  const tone = TONE[toast.tone]
  return (
    <div
      className={`toast-in pointer-events-auto flex items-start gap-2 rounded-[4px] border ${tone.edge} bg-[#0a0a10]/92 px-4 py-3 shadow-[0_18px_48px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl`}
      role="status"
    >
      <span className={`mt-[1px] shrink-0 ${tone.tint}`}>
        <Icon name={tone.icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-1)]">{toast.title}</div>
        {toast.detail ? <div className="mt-0.5 break-words text-[12px] leading-relaxed text-[var(--text-2)]">{toast.detail}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="关闭提示"
        className="t press flex items-center justify-center rounded-[4px] h-6 w-6 text-[var(--text-2)] hover:text-[var(--text-1)]"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

export function ToastHost() {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  return createPortal(
    <div className="pointer-events-none fixed bottom-[104px] right-5 z-50 flex w-[min(360px,calc(100vw-40px))] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  )
}
