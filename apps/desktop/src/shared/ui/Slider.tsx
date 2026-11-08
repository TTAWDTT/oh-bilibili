import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { clamp } from '../lib/format'

type SliderProps = {
  value: number
  label: string
  step: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
  disabled?: boolean
  buffered?: number | null
  size?: 'sm' | 'md'
}

/** 拖拽期间只回报 onChange，松手才 onCommit；这样 seek 不会在拖动途中被反复发出。 */
export function Slider({
  value,
  label,
  step,
  onChange,
  onCommit,
  disabled = false,
  buffered = null,
  size = 'md',
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const latest = useRef(value)
  latest.current = value

  const ratioAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return clamp((clientX - rect.left) / rect.width, 0, 1)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    onChange(ratioAt(event.clientX))
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    onChange(ratioAt(event.clientX))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onCommit(ratioAt(event.clientX))
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onCommit(latest.current)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const delta = event.shiftKey ? step * 5 : step
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      onCommit(clamp(value - delta, 0, 1))
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      onCommit(clamp(value + delta, 0, 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onCommit(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      onCommit(1)
    }
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      className={[
        'group relative flex touch-none items-center rounded-full',
        size === 'sm' ? 'h-4' : 'h-5',
        disabled ? 'cursor-default opacity-45' : 'cursor-pointer',
      ].join(' ')}
    >
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-[var(--line)]">
        {buffered === null ? null : (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--bili-pink)_22%,var(--line))]"
            style={{ width: `${clamp(buffered, 0, 1) * 100}%` }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${clamp(value, 0, 1) * 100}%`,
            // B 站的进度是粉色打头、往蓝色过渡，和它首页的双色一致
            background: 'linear-gradient(90deg, var(--accent), color-mix(in oklab, var(--bili-pink) 60%, var(--accent)))',
          }}
        />
      </div>
      <div
        className="t pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[var(--accent)] bg-white shadow-[0_0_8px_rgba(0,174,236,0.6)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100"
        style={{ left: `${clamp(value, 0, 1) * 100}%` }}
      />
    </div>
  )
}
