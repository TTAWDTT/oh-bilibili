import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CommentAnchor, NotePage } from './commentTime'

export function CommentTimeLink({
  anchor, pages, onSeek, children,
}: {
  anchor: CommentAnchor
  pages: readonly NotePage[]
  onSeek: (ms: number, page?: number) => void
  children: ReactNode
}) {
  const [choosing, setChoosing] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  if (anchor.invalid) return <>{children}</>
  const ambiguous = anchor.page === null && pages.length > 1
  return (
    <span>
      <button
        type="button"
        className="t text-[var(--accent)] hover:underline"
        aria-expanded={ambiguous ? choosing : undefined}
        onClick={() => ambiguous ? setChoosing(!choosing) : onSeek(anchor.ms, anchor.page ?? undefined)}
      >
        {children}{ambiguous ? '（分 P 未注明）' : ''}
      </button>
      {choosing ? (
        <span className="ml-1 inline-flex flex-wrap items-baseline gap-1">
          <select aria-label="选择分 P" value={chosen ?? ''} onChange={(e) => setChosen(Number(e.target.value))}>
            <option disabled value="">选择分 P</option>
            {pages.map((page) => (
              <option key={page.no} value={page.no} disabled={anchor.ms > page.duration_ms}>P{page.no}</option>
            ))}
          </select>
          {chosen !== null ? (
            <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => {
              onSeek(anchor.ms, chosen)
              setChoosing(false)
            }}>前往 P{chosen} · {anchor.token}</button>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}
