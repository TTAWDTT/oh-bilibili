import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Comment, CommentPage } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { useAuthStore } from '../auth/authStore'

/** 把评论里的 [表情] 代号换成 B 站表情图，其余文字原样保留。 */
function CommentText({ text, emotes }: { text: string; emotes: [string, string][] }) {
  if (emotes.length === 0) return <>{text}</>
  const map = new Map(emotes)
  const nodes: ReactNode[] = []
  let buffer = ''
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '[') {
      const end = text.indexOf(']', i)
      const code = end > i ? text.slice(i, end + 1) : ''
      const url = code ? map.get(code) : undefined
      if (url) {
        if (buffer) {
          nodes.push(buffer)
          buffer = ''
        }
        nodes.push(
          <img
            key={`${i}-${code}`}
            src={url}
            alt={code}
            title={code}
            referrerPolicy="no-referrer"
            className="mx-[1px] inline-block h-[20px] w-auto align-[-4px]"
          />,
        )
        i = end
        continue
      }
    }
    buffer += text[i]
  }
  if (buffer) nodes.push(buffer)
  return <>{nodes}</>
}

/** 一条评论，含楼中楼预览。一级评论可以回复。 */
function CommentRow({
  c,
  depth = 0,
  onReply,
  onDelete,
}: {
  c: Comment
  depth?: number
  onReply?: (c: Comment) => void
  onDelete?: ((c: Comment) => void) | undefined
}) {
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
            {depth === 0 && onReply ? (
              <button
                type="button"
                onClick={() => onReply(c)}
                className="t press shrink-0 text-[11px] text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                回复
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(c)}
                className="t press shrink-0 text-[11px] text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                删除
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-[var(--text-1)]">
            <CommentText text={c.text} emotes={c.emotes} />
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
export function CommentsPanel({ trackKey, flow = false }: { trackKey: string; flow?: boolean }) {
  /** B 站那一对按钮：热度优先，还是时间优先。 */
  const [hot, setHot] = useState(true)
  const [items, setItems] = useState<Comment[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null)
  /** 自己刚发的评论 rpid。只有这些能删，界面不会给别人的评论删按钮。 */
  const [mine, setMine] = useState<Set<string>>(new Set())
  const boxRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const pageRef = useRef(0)
  const seqRef = useRef(0)
  const me = useAuthStore((s) => s.auth?.user ?? null)

  // 评论区跟着整页一起滚时不能再自己滚一屏，否则是「滚动里套滚动」。
  // 到底没有交给 IntersectionObserver：哨兵进入整页滚动容器的可视区就取下一页。
  useEffect(() => {
    if (!flow) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const root = sentinel.closest('[data-scroll-root]')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasMore && !loading) void load(page + 1)
      },
      { root: root instanceof Element ? root : null, rootMargin: '240px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, hasMore, loading, page, trackKey])

  const load = async (next: number, byHot = hot): Promise<void> => {
    if (loadingRef.current || next <= pageRef.current) return
    const seq = seqRef.current
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const res: CommentPage = await ipc.watchComments(trackKey, next, byHot)
      if (seq !== seqRef.current) return
      setItems((prev) => (next === 1 ? res.items : [...prev, ...res.items]))
      setTotal(res.total)
      pageRef.current = next
      setPage(res.page)
      setHasMore(res.has_more)
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      if (seq === seqRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    seqRef.current += 1
    loadingRef.current = false
    setItems([])
    setTotal(0)
    setPage(0)
    pageRef.current = 0
    setHasMore(false)
    void load(1, hot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey, hot])

  const onScroll = (): void => {
    const box = boxRef.current
    if (!box || loading || !hasMore) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 240) void load(page + 1)
  }

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      // 回复一级评论：root 与 parent 都是那一条的 rpid。
      const rpid = await ipc.commentAdd(trackKey, text, replyTo?.id, replyTo?.id)
      setDraft('')
      setReplyTo(null)
      // 列表按热度排，刚发的没有热度，刷新也翻不到。把这条直接插到顶部，
      // 用户才看得到自己刚发的东西，也才有地方删。
      if (rpid) {
        setMine((prev) => new Set(prev).add(rpid))
        setItems((prev) => [
          {
            id: rpid,
            author: me?.uname ?? '我',
            avatar: me?.avatar ?? null,
            text,
            emotes: [],
            likes: 0,
            at: Math.floor(Date.now() / 1000),
            replies: [],
            reply_count: 0,
          },
          ...prev,
        ])
        setTotal((prev) => prev + 1)
      }
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      setSending(false)
    }
  }

  const remove = async (c: Comment): Promise<void> => {
    try {
      await ipc.commentDel(trackKey, c.id)
      setMine((prev) => {
        const next = new Set(prev)
        next.delete(c.id)
        return next
      })
      await load(1)
    } catch (e) {
      setError(toWireError(e).message)
    }
  }

  return (
    <div className={flow ? 'flex flex-col' : 'flex min-h-0 flex-col'}>
      <div className={`flex items-baseline gap-2 py-3 ${flow ? '' : 'px-3'}`}>
        <h3 className="text-[14px] font-medium">评论</h3>
        <span className="num text-[12px] text-[var(--text-3)]">
          {total > 0 ? formatCount(total) : '—'}
        </span>
        <div className="ml-auto flex items-center gap-1 text-[12px]">
          {[
            { on: true, label: '最热' },
            { on: false, label: '最新' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={hot === option.on}
              onClick={() => setHot(option.on)}
              className={`t press rounded-[4px] px-2 py-0.5 ${
                hot === option.on
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className={`border-b border-hairline pb-3 ${flow ? '' : 'px-3'}`}>
        {replyTo ? (
          <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--text-3)]">
            <span>回复 @{replyTo.author}</span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="t press hover:text-[var(--text-1)]"
            >
              取消
            </button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
            placeholder={replyTo ? `回复 @${replyTo.author}` : '发一条评论'}
            aria-label="发评论"
            className="h-8 min-w-0 flex-1 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-2 text-[12px] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!draft.trim() || sending}
            className="t press h-8 shrink-0 rounded-[6px] bg-[var(--accent)] px-3 text-[12px] text-white disabled:opacity-40"
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
      <div
        ref={boxRef}
        onScroll={flow ? undefined : onScroll}
        className={flow ? 'pb-6' : 'min-h-0 flex-1 overflow-y-auto px-3 pb-4'}
      >
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
        <ul className="max-w-[880px] space-y-4">
          {items.map((c) => (
            <CommentRow
              key={c.id}
              c={c}
              onReply={(target) => setReplyTo({ id: target.id, author: target.author })}
              onDelete={mine.has(c.id) ? remove : undefined}
            />
          ))}
        </ul>
        {loading ? (
          <p className="py-3 text-center text-[12px] text-[var(--text-3)]">正在取评论…</p>
        ) : null}
        {!loading && !hasMore && items.length > 0 ? (
          <p className="py-3 text-center text-[11px] text-[var(--text-3)]">到底了</p>
        ) : null}
        {flow ? <div ref={sentinelRef} className="h-1" /> : null}
      </div>
    </div>
  )
}
