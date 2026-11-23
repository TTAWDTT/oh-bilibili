import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type Anchor = { left: number; top: number; anchorTop: number; trigger?: HTMLElement }

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
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .filter((dialog) => dialog.getClientRects().length)
      if (dialogs.at(-1) !== panelRef.current) return
      event.preventDefault()
      event.stopPropagation()
      close()
      anchor.trigger?.focus({ preventScroll: true })
    }
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      close()
    }
    const onOutside = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || panelRef.current?.contains(target) || anchor.trigger?.contains(target)) return
      close()
    }
    if (anchor.trigger) document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [anchor, onClose])

  useLayoutEffect(() => {
    if (!anchor?.trigger) return
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)')
    ;(first ?? panel)?.focus({ preventScroll: true })
  }, [anchor])

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
      {!anchor.trigger ? <button
        type="button"
        aria-label="关闭"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      /> : null}
      <div
        ref={panelRef}
        tabIndex={-1}
        onBlur={(event) => {
          if (anchor.trigger && event.relatedTarget && event.relatedTarget !== anchor.trigger && !event.currentTarget.contains(event.relatedTarget)) onClose()
        }}
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
