import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Comment, CommentPage } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'

/** 一条评论，含楼中楼预览。 */
function CommentRow({ c, depth = 0 }: { c: Comment; depth?: number }) {
  return (
    <li className={depth > 0 ? 'mt-2 border-l border-[var(--line)] pl-3' : ''}>
      <div className="flex items-start gap-2">
        {c.avatar ? (
          <img
            src={c.avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-[var(--panel-alt)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[12px] text-[var(--text-2)]">{c.author}</span>
            {c.likes > 0 ? (
              <span className="num shrink-0 text-[11px] text-[var(--text-3)]">
                {formatCount(c.likes)} 赞
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-[var(--text-1)]">
            {c.text}
          </p>
        </div>
      </div>
      {c.replies.length > 0 ? (
        <ul className="mt-1 pl-8">
          {c.replies.map((r) => (
            <CommentRow key={r.id || `${c.id}-${r.author}-${r.text.slice(0, 8)}`} c={r} depth={depth + 1} />
          ))}
          {c.reply_count > c.replies.length ? (
            <li className="mt-1 text-[11px] text-[var(--text-3)]">
              共 {formatCount(c.reply_count)} 条回复
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * 评论区。
 *
 * 分页按需加载，滚动到底部自动取下一页。取不到内容时给明确文案，
 * 不白屏，也不影响看视频。
 */
export function CommentsPanel({ trackKey }: { trackKey: string }) {
  const [items, setItems] = useState<Comment[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const load = async (next: number): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res: CommentPage = await ipc.watchComments(trackKey, next)
      setItems((prev) => (next === 1 ? res.items : [...prev, ...res.items]))
      setTotal(res.total)
      setPage(res.page)
      setHasMore(res.has_more)
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setItems([])
    setTotal(0)
    setPage(0)
    setHasMore(false)
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey])

  const onScroll = (): void => {
    const box = boxRef.current
    if (!box || loading || !hasMore) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 240) void load(page + 1)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-baseline gap-2 px-3 py-2">
        <h3 className="text-[13px] font-medium">评论</h3>
        <span className="num text-[12px] text-[var(--text-3)]">
          {total > 0 ? formatCount(total) : '—'}
        </span>
      </div>
      <div ref={boxRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {items.length === 0 && !loading && !error ? (
          <p className="py-6 text-center text-[12px] text-[var(--text-3)]">
            这条视频还没有评论。
          </p>
        ) : null}
        {error ? (
          <div className="py-6 text-center text-[12px] text-[var(--text-3)]">
            <p>评论没取到：{error}</p>
            <button
              type="button"
              onClick={() => void load(Math.max(1, page))}
              className="t press mt-2 rounded-[6px] border border-[var(--line)] px-3 py-1 hover:bg-[var(--panel-alt)]"
            >
              重试
            </button>
          </div>
        ) : null}
        <ul className="space-y-3">
          {items.map((c) => (
            <CommentRow key={c.id} c={c} />
          ))}
        </ul>
        {loading ? (
          <p className="py-3 text-center text-[12px] text-[var(--text-3)]">正在取评论…</p>
        ) : null}
        {!loading && !hasMore && items.length > 0 ? (
          <p className="py-3 text-center text-[11px] text-[var(--text-3)]">到底了</p>
        ) : null}
      </div>
    </div>
  )
}
