import { useState } from 'react'
import type { CommentAnchor, NotePage } from './commentTime'
import { CommentTimeLink } from './CommentTimeLink'
import { noteSentence } from './noteSentence'
import { Icon } from '../../shared/ui/Icon'

export type CommentNote = {
  id: string
  author: string
  text: string
  anchors: CommentAnchor[]
}

export function NoteReader({
  note, pages, onSeek, onBack,
}: {
  note: CommentNote
  pages: readonly NotePage[]
  onSeek: (ms: number, page?: number) => void
  onBack: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <section data-watch-note tabIndex={-1} className="border-b border-hairline px-3 py-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-[12.5px] text-[var(--text-2)]">
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
            className="flex max-w-full items-center gap-1">
            <Icon name="chevronRight" size={12} className={expanded ? 'rotate-90' : ''} />
            <span className="truncate">边看边读 · {note.author}</span>
          </button>
        </h3>
        <button type="button" onClick={onBack} className="shrink-0 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]">
          回到原评论
        </button>
      </div>
      {expanded ? (
        <ul className="mt-2 space-y-1">
          {note.anchors.map((anchor) => (
            <li key={anchor.start} className="flex flex-wrap items-baseline gap-x-2 py-1 text-[12px] leading-[18px]">
              <span className="num">
                <CommentTimeLink anchor={anchor} pages={pages} onSeek={onSeek}>
                  {anchor.invalid ? note.text.slice(anchor.start, anchor.end) :
                    (anchor.page !== null && pages.length > 1 ? `P${anchor.page} ${anchor.token}` : anchor.token)}
                </CommentTimeLink>
              </span>
              <span className="min-w-0 break-words text-[var(--text-2)]">{noteSentence(note.text, anchor)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
