import type { CommentAnchor } from './commentTime'
import { noteSentence } from './noteSentence'
import { Icon } from '../../shared/ui/Icon'

export type CommentNote = {
  id: string
  author: string
  text: string
  anchors: CommentAnchor[]
}

/**
 * 「边看边读」：把一条评论里的时间点整理成一列，点哪条跳哪条。
 *
 * 面板只读评论原文，不启动播放；每条给原文句子，「回到原评论」滚回并聚焦原楼。
 */
export function NoteReader({
  note,
  onSeek,
  onBack,
  onClose,
}: {
  note: CommentNote
  onSeek: (anchor: CommentAnchor) => void
  onBack: () => void
  onClose: () => void
}) {
  return (
    <section data-watch-note className="border-b border-hairline px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-2)]">
          边看边读 · {note.author}
        </h3>
        <button type="button" onClick={onClose} aria-label="收起笔记" className="t text-[var(--text-3)] hover:text-[var(--text-1)]">
          <Icon name="close" size={13} />
        </button>
      </div>
      <ul className="space-y-1">
        {note.anchors.map((anchor) => (
          <li key={`${anchor.start}-${anchor.token}`}>
            <button
              type="button"
              onClick={() => onSeek(anchor)}
              className="t flex w-full items-baseline gap-2 rounded-[4px] px-1 py-1 text-left hover:bg-[var(--panel-alt)]"
            >
              <span className="num shrink-0 text-[12px] text-[var(--accent)]">
                {anchor.page ? `P${anchor.page} ` : ''}
                {anchor.token}
              </span>
              <span className="line-clamp-2 min-w-0 text-[12px] leading-[17px] text-[var(--text-2)]">
                {noteSentence(note.text, anchor) || '（只有时间点）'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onBack}
        className="t mt-2 flex items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
      >
        <Icon name="chevronLeft" size={12} />
        回到原评论
      </button>
    </section>
  )
}
