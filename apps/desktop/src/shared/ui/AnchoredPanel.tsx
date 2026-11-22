import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type Anchor = { left: number; top: number; anchorTop: number }

export function AnchoredPanel({
  anchor,
  onClose,
  label,
  width = 268,
  children,
}: {
  anchor: Anchor | null
  onClose: () => void
  label: string
  width?: number
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [top, setTop] = useState<number | null>(null)

  useEffect(() => {
    if (!anchor) return
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [anchor, onClose])

  // 靠近窗口底部时向上翻；先渲染一帧量真实高度，避免写死面板高度。
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!anchor || !panel) return
    const height = panel.offsetHeight
    const next =
      anchor.top + height > window.innerHeight - 8
        ? Math.max(8, anchor.anchorTop - height - 8)
        : anchor.top
    setTop(next)
  }, [anchor])

  if (!anchor) return null

  return (
    <>
      <button
        type="button"
        aria-label="关闭"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        style={{ left: anchor.left, top: top ?? anchor.top, width }}
        className="fixed z-50 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.3)]"
      >
        {children}
      </div>
    </>
  )
}
