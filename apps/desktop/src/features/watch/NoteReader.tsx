import { useState } from 'react'
import type { CommentAnchor } from './commentTime'
import { noteSentence } from './noteSentence'
import { Icon } from '../../shared/ui/Icon'

export type CommentNote = {
  id: string
  author: string
  text: string
  anchors: CommentAnchor[]
}

/** 目录里的一页；只用到页号和时长，用来核对能不能跳。 */
export type NotePage = { no: number; duration_ms: number }

/**
 * 「边看边读」：把一条评论里的时间点整理成一列，点哪条跳哪条。
 *
 * 多 P 稿件里没写明分 P 的时间点不猜当前页，先让用户选一次；
 * 这一条的选择不会带到其他条目。面板只读评论原文，不启动播放。
 */
export function NoteReader({
  note,
  pages,
  onSeek,
  onBack,
  onClose,
}: {
  note: CommentNote
  pages: NotePage[]
  onSeek: (anchor: CommentAnchor) => void
  onBack: () => void
  onClose: () => void
}) {
  /** 分 P 未注明时，用户为某一条选过哪一页；键是时间点在原文的起点。 */
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [asking, setAsking] = useState<number | null>(null)
  const multi = pages.length > 1

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
        {note.anchors.map((anchor) => {
          const sentence = noteSentence(note.text, anchor) || '（只有时间点）'
          if (anchor.invalid) {
            return (
              <li key={`${anchor.start}-${anchor.token}`} className="flex items-baseline gap-2 px-1 py-1">
                <span className="num shrink-0 text-[12px] text-[var(--text-3)]">{anchor.token}</span>
                <span className="line-clamp-2 min-w-0 text-[12px] leading-[17px] text-[var(--text-3)]">
                  {sentence}
                  <span className="ml-1 text-[11px]">（不自动跳转）</span>
                </span>
              </li>
            )
          }
          const needPage = multi && anchor.page === null
          const chosen = picked[anchor.start]
          const open = asking === anchor.start
          return (
            <li key={`${anchor.start}-${anchor.token}`}>
              <button
                type="button"
                onClick={() => {
                  if (needPage && chosen === undefined) {
                    setAsking(open ? null : anchor.start)
                    return
                  }
                  onSeek(chosen === undefined ? anchor : { ...anchor, page: chosen })
                }}
                title={needPage && chosen === undefined ? '先选一个分 P' : undefined}
                className="t flex w-full items-baseline gap-2 rounded-[4px] px-1 py-1 text-left hover:bg-[var(--panel-alt)]"
              >
                <span className="num shrink-0 text-[12px] text-[var(--accent)]">
                  {anchor.page ? `P${anchor.page} ` : chosen !== undefined ? `P${chosen} ` : ''}
                  {anchor.token}
                </span>
                {needPage && chosen === undefined ? (
                  <span className="shrink-0 text-[11px] text-[var(--text-3)]">分 P 未注明</span>
                ) : null}
                <span className="line-clamp-2 min-w-0 text-[12px] leading-[17px] text-[var(--text-2)]">
                  {sentence}
                </span>
              </button>
              {open ? (
                <div className="mt-1 flex flex-wrap items-center gap-1 pl-1" role="group" aria-label="选择分 P">
                  <span className="text-[11px] text-[var(--text-3)]">前往</span>
                  {pages.map((entry) => (
                    <button
                      key={entry.no}
                      type="button"
                      onClick={() => {
                        setPicked((prev) => ({ ...prev, [anchor.start]: entry.no }))
                        setAsking(null)
                        onSeek({ ...anchor, page: entry.no })
                      }}
                      className="t press num rounded-[3px] px-1.5 text-[11.5px] leading-[18px] text-[var(--text-2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                    >
                      P{entry.no}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          )
        })}
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
