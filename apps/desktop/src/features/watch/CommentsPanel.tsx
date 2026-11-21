import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Comment, CommentMedal, CommentPage } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatRelative } from '../../shared/lib/format'
import { COMMENT_PREFETCH_PX } from '../../shared/lib/prefetch'
import { Avatar } from '../../shared/ui/Avatar'
import { AuthorHoverCard, useAuthorHover } from '../../shared/ui/AuthorHoverCard'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { Modal } from '../../shared/ui/Modal'
import { useAuthStore } from '../auth/authStore'

/** 对话页大小，与后端 `reply/dialog/cursor` 的 `size` 参数一致。 */
const DIALOG_PAGE_SIZE = 20

/** 评论排序是用户偏好，切视频、重启后都应该沿用。 */
const COMMENT_SORT_KEY = 'oh-bilibili:comments:hot'

/**
 * 长评论是否需要「展开」要量一次真实行高。量法会克隆正文并强制布局，
 * 一千条评论同时量会把主线程打出几千次布局。共享一个观察器，只在
 * 评论进入视口附近时量，离屏的评论保持未测量。
 */
const expandMeasure = new WeakMap<Element, () => void>()
const expandObserver =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const run = expandMeasure.get(entry.target)
            if (!run) continue
            expandMeasure.delete(entry.target)
            expandObserver?.unobserve(entry.target)
            run()
          }
        },
        { rootMargin: '300px' },
      )

function loadCommentHot(): boolean {
  try {
    return localStorage.getItem(COMMENT_SORT_KEY) !== '0'
  } catch {
    return true
  }
}

function saveCommentHot(hot: boolean): void {
  try {
    localStorage.setItem(COMMENT_SORT_KEY, hot ? '1' : '0')
  } catch {
    // 隐私模式写不进去，只影响这次会话
  }
}

/** 把一段纯文字里的 @名字 换成可点链接；名字必须出现在接口给的 members 里。 */
function mentionNodes(
  text: string,
  mentions: [string, number][],
  open: (name: string, mid: number) => void,
  keyBase: number,
  onSeek?: ((ms: number) => void) | undefined,
): ReactNode[] {
  // URL 整段保留，@ 只在非 URL 段落里找，避免把链接路径里的 @ 拆开。
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  const nodes: ReactNode[] = []
  parts.forEach((part, index) => {
    if (/^https?:\/\//.test(part)) {
      const url = part.replace(/[.,;:!?，。；、）…]+$/, '')
      const trailing = part.slice(url.length)
      nodes.push(
        <button
          key={`${keyBase}-url-${index}`}
          type="button"
          onClick={() => void ipc.openExternal(url).catch(() => {})}
          className="t break-all text-left text-[var(--accent)] hover:underline"
        >
          {url}
        </button>,
      )
      if (trailing) nodes.push(trailing)
      return
    }
    if (mentions.length === 0) {
      nodes.push(...timestampLinks(part, onSeek, keyBase * 100 + index))
      return
    }
    nodes.push(...mentionLinks(part, mentions, open, keyBase * 100 + index, onSeek))
  })
  return nodes
}

/** 在纯文字里找已知用户名的 @；前后都留边界，避免 @foo 命中 @foobar。 */
function mentionLinks(
  text: string,
  mentions: [string, number][],
  open: (name: string, mid: number) => void,
  keyBase: number,
  onSeek?: ((ms: number) => void) | undefined,
): ReactNode[] {
  const names = [...mentions]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(
    `(^|[^/\\s@])@(${names.join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  )
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const prefix = match[1] ?? ''
    const at = (match.index ?? 0) + prefix.length
    if (at > last) nodes.push(...timestampLinks(text.slice(last, at), onSeek, keyBase * 100 + at))
    const name = match[2] ?? ''
    const mid = mentions.find(([value]) => value === name)?.[1] ?? 0
    nodes.push(
      <button
        key={`${keyBase}-${at}`}
        type="button"
        onClick={() => open(name, mid)}
        className="t text-[var(--accent)] hover:underline"
      >
        @{name}
      </button>,
    )
    last = (match.index ?? 0) + match[0].length
  }
  if (last < text.length) {
    nodes.push(...timestampLinks(text.slice(last), onSeek, keyBase * 100 + last))
  }
  return nodes
}

/** `01:23` / `1:02:03` 转毫秒。评论里的时间戳和简介一样可以点着跳。 */
function timestampMs(token: string): number | null {
  const parts = token.replace(/：/g, ':').split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 2) return ((parts[0] ?? 0) * 60 + (parts[1] ?? 0)) * 1000
  if (parts.length === 3) {
    return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * 1000
  }
  return null
}

function timestampLinks(
  text: string,
  onSeek: ((ms: number) => void) | undefined,
  keyBase: number,
): ReactNode[] {
  if (!onSeek) return [text]
  const nodes: ReactNode[] = []
  const pattern = /\b((?:\d{1,2}[:：])?[0-5]?\d[:：][0-5]\d)\b/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const token = match[1] ?? ''
    const at = match.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    const ms = timestampMs(token)
    if (ms === null) {
      nodes.push(token)
    } else {
      nodes.push(
        <button
          key={`${keyBase}-${at}`}
          type="button"
          onClick={() => onSeek(ms)}
          className="t text-[var(--accent)] hover:underline"
        >
          {token}
        </button>,
      )
    }
    last = at + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** 把评论里的 [表情] 代号换成 B 站表情图，@用户 换成可点链接，其余文字原样保留。 */
function CommentText({
  text,
  emotes,
  mentions,
  onSeek,
}: {
  text: string
  emotes: [string, string][]
  mentions: [string, number][]
  onSeek?: ((ms: number) => void) | undefined
}) {
  const navigate = useAppStore((state) => state.navigate)
  if (emotes.length === 0 && mentions.length === 0) {
    return (
      <>
        {mentionNodes(
          text,
          mentions,
          (name, mid) => navigate({ kind: 'author', name, mid }),
          0,
          onSeek,
        )}
      </>
    )
  }
  const map = new Map(emotes)
  const nodes: ReactNode[] = []
  let buffer = ''
  let chunk = 0
  const flush = (): void => {
    if (!buffer) return
    nodes.push(
      ...mentionNodes(
        buffer,
        mentions,
        (name, mid) => navigate({ kind: 'author', name, mid }),
        chunk,
        onSeek,
      ),
    )
    buffer = ''
    chunk += 1
  }
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '[') {
      const end = text.indexOf(']', i)
      const code = end > i ? text.slice(i, end + 1) : ''
      const url = code ? map.get(code) : undefined
      if (url) {
        flush()
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
  flush()
  return <>{nodes}</>
}

/** 接口给的是 0xAARRGGBB，取低 24 位当 CSS 颜色。 */
function medalColor(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`
}

/** B 站粉丝牌：名字一段渐变胶囊，右侧等级块。 */
function CommentMedalBadge({ medal }: { medal: CommentMedal }) {
  return (
    <span
      className="flex h-4 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-[2px] border text-[10px] leading-[14px]"
      style={{
        borderColor: medalColor(medal.color_border),
        background: `linear-gradient(90deg, ${medalColor(medal.color)}, ${medalColor(medal.color_end)})`,
      }}
      title={`${medal.name} ${medal.level}`}
    >
      <span className="px-1" style={{ color: medalColor(medal.color_name) }}>
        {medal.name}
      </span>
      <span
        className="flex h-full items-center px-1"
        style={{ background: medalColor(medal.level_bg), color: medalColor(medal.color_level) }}
      >
        {medal.level}
      </span>
    </span>
  )
}

/** 一条评论，含楼中楼预览。一级评论可以回复。 */
function CommentRow({
  c,
  depth = 0,
  trackKey,
  ownerMid,
  onReply,
  onDelete,
  deleteFor,
  replyComposer,
  replyComposerFor,
  onDialog,
  onPhoto,
  onSeek,
  onAuthorHover,
  onAuthorHide,
}: {
  c: Comment
  depth?: number
  trackKey: string
  ownerMid?: number | null | undefined
  onReply?: ((c: Comment) => void) | undefined
  onDelete?: ((c: Comment) => void) | undefined
  /** 楼中楼里某一条能删时给按钮；根节点把同一个回调继续传下去。 */
  deleteFor?: ((c: Comment) => ((c: Comment) => void) | undefined) | undefined
  replyComposer?: ReactNode
  /** 楼中楼里某一条要展开回复框时用；根节点把同一个回调继续传下去。 */
  replyComposerFor?: ((c: Comment) => ReactNode) | undefined
  onDialog?: ((c: Comment) => void) | undefined
  onPhoto?: ((pictures: string[], index: number) => void) | undefined
  onSeek?: ((ms: number) => void) | undefined
  onAuthorHover?: ((c: Comment, el: HTMLElement) => void) | undefined
  onAuthorHide?: (() => void) | undefined
}) {
  const navigate = useAppStore((state) => state.navigate)
  const [repliesOpen, setRepliesOpen] = useState(false)
  const [loadedReplies, setLoadedReplies] = useState<Comment[]>([])
  const [repliesCursor, setRepliesCursor] = useState<string | null>(null)
  const [repliesLoaded, setRepliesLoaded] = useState(false)
  const [repliesHasMore, setRepliesHasMore] = useState(false)
  const [repliesLoading, setRepliesLoading] = useState(false)
  const [repliesError, setRepliesError] = useState(false)
  const [liked, setLiked] = useState(c.liked)
  const [likes, setLikes] = useState(c.likes)
  const [disliked, setDisliked] = useState(c.disliked)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const likingRef = useRef(false)
  const hatingRef = useRef(false)

  useEffect(() => {
    if (expanded) return
    const el = textRef.current
    if (!el) return
    if (c.text.length < 120) {
      setCanExpand(false)
      return
    }
    let cancelled = false
    const measure = (): void => {
      // line-clamp 会把 scrollHeight 也裁到可见高度，只能拿同宽克隆量完整高度。
      const clone = el.cloneNode(true) as HTMLElement
      clone.classList.remove('line-clamp-6')
      clone.style.position = 'absolute'
      clone.style.visibility = 'hidden'
      clone.style.left = '-9999px'
      clone.style.top = '0'
      clone.style.width = `${el.clientWidth}px`
      clone.style.display = 'block'
      clone.style.webkitLineClamp = 'unset'
      document.body.appendChild(clone)
      const full = clone.scrollHeight
      clone.remove()
      if (!cancelled) setCanExpand(full > el.clientHeight + 1)
    }
    expandMeasure.set(el, measure)
    expandObserver?.observe(el)
    return () => {
      cancelled = true
      expandMeasure.delete(el)
      expandObserver?.unobserve(el)
    }
  }, [c.text, expanded])

  const toggleLike = async (): Promise<void> => {
    if (likingRef.current) return
    likingRef.current = true
    const next = !liked
    const wasDisliked = disliked
    setLiked(next)
    if (next) setDisliked(false)
    setLikes((count) => Math.max(0, count + (next ? 1 : -1)))
    try {
      await ipc.commentLike(trackKey, c.id, next)
    } catch {
      setLiked(!next)
      if (next) setDisliked(wasDisliked)
      setLikes((count) => Math.max(0, count + (next ? -1 : 1)))
    } finally {
      likingRef.current = false
    }
  }

  const toggleDislike = async (): Promise<void> => {
    if (hatingRef.current) return
    hatingRef.current = true
    const next = !disliked
    const wasLiked = liked
    setDisliked(next)
    if (next && wasLiked) {
      setLiked(false)
      setLikes((count) => Math.max(0, count - 1))
    }
    try {
      await ipc.commentHate(trackKey, c.id, next)
    } catch {
      setDisliked(!next)
      if (next && wasLiked) {
        setLiked(true)
        setLikes((count) => count + 1)
      }
    } finally {
      hatingRef.current = false
    }
  }

  const loadReplies = async (cursor: string | null): Promise<void> => {
    if (repliesLoading) return
    setRepliesLoading(true)
    setRepliesError(false)
    try {
      const res = await ipc.watchReplies(trackKey, c.id, cursor)
      setLoadedReplies((prev) => (cursor === null ? res.items : [...prev, ...res.items]))
      setRepliesCursor(res.next)
      setRepliesHasMore(res.has_more)
      setRepliesLoaded(true)
      // 只有首次展开才顺带开楼；收起期间返回的下一页不该把它掰回来。
      if (cursor === null) setRepliesOpen(true)
    } catch {
      setRepliesError(true)
    } finally {
      setRepliesLoading(false)
    }
  }

  const toggleReplies = (): void => {
    if (repliesOpen) {
      setRepliesOpen(false)
      setRepliesError(false)
      return
    }
    // 收起只隐藏；已经翻到的页和游标留着，再展开接着往下翻。
    if (repliesLoaded) {
      setRepliesOpen(true)
      return
    }
    void loadReplies(null)
  }

  const shownReplies = depth === 0 && repliesOpen ? loadedReplies : c.replies

  return (
    <li
      data-comment-id={c.id}
      data-comment-mid={c.mid}
      data-comment-depth={depth}
      className={depth > 0 ? 'mt-2 border-l border-[var(--line)] pl-3' : ''}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <Avatar src={c.avatar} alt={c.author} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {c.medal ? <CommentMedalBadge medal={c.medal} /> : null}
            {c.mid > 0 ? (
              <button
                type="button"
                onClick={() => navigate({ kind: 'author', name: c.author, mid: c.mid })}
                onMouseEnter={(event) => onAuthorHover?.(c, event.currentTarget)}
                onMouseLeave={onAuthorHide}
                title={`看 ${c.author} 的空间`}
                className="t min-w-0 truncate text-left text-[12px] text-[var(--text-2)] hover:text-[var(--accent)]"
              >
                {c.author}
              </button>
            ) : (
              <span className="truncate text-[12px] text-[var(--text-2)]">{c.author}</span>
            )}
            {c.level > 0 ? <LevelBadge level={c.level} /> : null}
            {c.vip ? (
              <span className="shrink-0 rounded-[2px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
                大会员
              </span>
            ) : null}
            {c.pinned ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-[2px] bg-[var(--accent-soft)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
                置顶
              </span>
            ) : null}
            {!c.pinned && ownerMid && c.mid === ownerMid ? (
              <span className="shrink-0 rounded-[2px] bg-[var(--accent-soft)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
                UP主
              </span>
            ) : null}
            {/* B 站评论头行右侧是「拇指 数」+「拇指朝下」两颗灰图标，
                即使 0 赞也留着位置，一排评论扫下来才是同一个形状。 */}
            <span className="num ml-auto flex shrink-0 items-center gap-3 text-[11px] text-[var(--text-3)]">
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-pressed={liked}
                  aria-label={liked ? '取消点赞' : '点赞'}
                  title={liked ? '取消点赞' : '点赞'}
                  onClick={() => void toggleLike()}
                  className={`t press flex items-center gap-0.5 rounded-[3px] ${
                    liked ? 'text-[var(--accent)]' : 'hover:text-[var(--accent)]'
                  }`}
                >
                  <Icon name={liked ? 'thumbFilled' : 'thumb'} size={12} />
                  {likes > 0 ? formatCount(likes) : null}
                </button>
                {c.up_liked ? (
                  <span title="UP主觉得很赞" className="ml-0.5 text-[var(--accent)]">
                    <Icon name="thumb" size={12} />
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                aria-pressed={disliked}
                aria-label={disliked ? '取消点踩' : '点踩'}
                title={disliked ? '取消点踩' : '点踩'}
                onClick={() => void toggleDislike()}
                className={`t press rounded-[3px] ${
                  disliked ? 'text-[var(--accent)]' : 'hover:text-[var(--accent)]'
                }`}
              >
                <Icon name="thumbDown" size={12} />
              </button>
            </span>
            <span className="num shrink-0 text-[11px] text-[var(--text-3)]">{formatRelative(c.at)}</span>
            {c.location ? (
              <span className="num hidden shrink-0 text-[11px] text-[var(--text-3)] md:inline">
                {c.location}
              </span>
            ) : null}
            {depth > 0 && onDialog && (c.parent ?? 0) !== (c.root ?? 0) && (c.dialog ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => onDialog(c)}
                className="t press shrink-0 text-[11px] text-[var(--accent)] hover:underline"
              >
                查看对话
              </button>
            ) : null}
            {onReply ? (
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
          <p
            ref={textRef}
            className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-[var(--text-1)] ${
              expanded ? '' : 'line-clamp-6'
            }`}
          >
            <CommentText
              text={c.text}
              emotes={c.emotes}
              mentions={c.mentions}
              onSeek={onSeek}
            />
          </p>
          {canExpand ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="t mt-1 text-[11px] text-[var(--accent)] hover:underline"
            >
              {expanded ? '收起' : '展开'}
            </button>
          ) : null}
          {c.pictures?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.pictures.slice(0, 9).map((src, index) => (
                <button
                  key={`${src}-${index}`}
                  type="button"
                  aria-label={`查看第 ${index + 1} 张评论图片`}
                  onClick={() => onPhoto?.(c.pictures, index)}
                  className="h-[88px] w-[88px] overflow-hidden rounded-[4px] bg-[var(--panel-alt)]"
                >
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {replyComposer ? <div className="mt-2 pl-8">{replyComposer}</div> : null}
      {c.replies.length > 0 || (depth === 0 && c.reply_count > 0) ? (
        <ul className="mt-1 pl-8">
          {shownReplies.map((r) => (
            <CommentRow
              key={r.id || `${c.id}-${r.author}-${r.text.slice(0, 8)}`}
              c={r}
              depth={depth + 1}
              trackKey={trackKey}
              ownerMid={ownerMid}
              onReply={onReply}
              onDelete={deleteFor?.(r)}
              deleteFor={deleteFor}
              replyComposerFor={replyComposerFor}
              replyComposer={replyComposerFor?.(r)}
              onDialog={onDialog}
              onPhoto={onPhoto}
              onSeek={onSeek}
              onAuthorHover={onAuthorHover}
              onAuthorHide={onAuthorHide}
            />
          ))}
          {depth === 0 && (c.reply_count > c.replies.length || repliesOpen) ? (
            <li className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
              {repliesOpen ? (
                <>
                  {repliesHasMore ? (
                    repliesLoading ? (
                      <BiliLoader compact label="正在取回复…" />
                    ) : repliesError ? (
                      <button
                        type="button"
                        onClick={() => void loadReplies(repliesCursor)}
                        className="t press text-[var(--accent)] hover:opacity-80"
                      >
                        回复没取到，重试
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void loadReplies(repliesCursor)}
                        className="t press inline-flex items-center gap-1 text-[var(--accent)] hover:opacity-80"
                      >
                        展开更多回复
                        <Icon name="chevronLeft" size={11} className="rotate-90" />
                      </button>
                    )
                  ) : repliesLoading ? (
                    <BiliLoader compact label="正在取回复…" />
                  ) : null}
                  <button
                    type="button"
                    aria-expanded
                    onClick={toggleReplies}
                    className="t press inline-flex items-center gap-1 text-[var(--accent)] hover:opacity-80"
                  >
                    收起
                    <Icon name="chevronLeft" size={11} className="-rotate-90" />
                  </button>
                </>
              ) : repliesLoading ? (
                <BiliLoader compact label="正在取回复…" />
              ) : repliesError ? (
                <button
                  type="button"
                  onClick={toggleReplies}
                  className="t press text-[var(--accent)] hover:opacity-80"
                >
                  回复没取到，重试
                </button>
              ) : (
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={toggleReplies}
                  className="t press inline-flex items-center gap-1 text-[var(--accent)] hover:opacity-80"
                >
                  共 {formatCount(c.reply_count)} 条回复
                  <Icon name="chevronLeft" size={11} className="rotate-90" />
                </button>
              )}
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
/** 对话里的一条。比列表里的评论少一排操作，只保留作者、等级、粉丝牌和正文。 */
function DialogRow({
  c,
  ownerMid,
  onPhoto,
  onSeek,
  onAuthorHover,
  onAuthorHide,
}: {
  c: Comment
  ownerMid: number | null
  onPhoto?: ((pictures: string[], index: number) => void) | undefined
  onSeek?: ((ms: number) => void) | undefined
  onAuthorHover?: ((c: Comment, el: HTMLElement) => void) | undefined
  onAuthorHide?: (() => void) | undefined
}) {
  const navigate = useAppStore((state) => state.navigate)
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">
        <Avatar src={c.avatar} alt={c.author} size={24} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {c.medal ? <CommentMedalBadge medal={c.medal} /> : null}
          {c.mid > 0 ? (
            <button
              type="button"
              onClick={() => navigate({ kind: 'author', name: c.author, mid: c.mid })}
              onMouseEnter={(event) => onAuthorHover?.(c, event.currentTarget)}
              onMouseLeave={onAuthorHide}
              title={`看 ${c.author} 的空间`}
              className="t min-w-0 truncate text-left text-[12px] text-[var(--text-2)] hover:text-[var(--accent)]"
            >
              {c.author}
            </button>
          ) : (
            <span className="truncate text-[12px] text-[var(--text-2)]">{c.author}</span>
          )}
          {c.level > 0 ? <LevelBadge level={c.level} /> : null}
          {c.vip ? (
            <span className="shrink-0 rounded-[2px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
              大会员
            </span>
          ) : null}
          {ownerMid !== null && c.mid === ownerMid ? (
            <span className="shrink-0 rounded-[2px] bg-[var(--accent-soft)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
              UP主
            </span>
          ) : null}
          <span className="num ml-auto shrink-0 text-[11px] text-[var(--text-3)]">{formatRelative(c.at)}</span>
          {c.location ? (
            <span className="num hidden shrink-0 text-[11px] text-[var(--text-3)] sm:inline">
              {c.location}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-[var(--text-1)]">
          <CommentText
            text={c.text}
            emotes={c.emotes}
            mentions={c.mentions}
            onSeek={onSeek}
          />
        </p>
        {c.pictures?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {c.pictures.slice(0, 9).map((src, index) => (
              <button
                key={`${src}-${index}`}
                type="button"
                onClick={() => onPhoto?.(c.pictures, index)}
                className="h-16 w-16 overflow-hidden rounded-[4px] bg-[var(--panel-alt)]"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** 查看对话：`dialog/cursor` 按一条对话分支翻页，和楼中楼列表是两支接口。 */
function DialogModal({
  open,
  trackKey,
  ownerMid,
  root,
  anchor,
  onClose,
  onPhoto,
  onSeek,
  onAuthorHover,
  onAuthorHide,
}: {
  open: boolean
  trackKey: string
  ownerMid: number | null
  root: string
  anchor: string
  onClose: () => void
  onPhoto?: ((pictures: string[], index: number) => void) | undefined
  onSeek?: ((ms: number) => void) | undefined
  onAuthorHover?: ((c: Comment, el: HTMLElement) => void) | undefined
  onAuthorHide?: (() => void) | undefined
}) {
  const [items, setItems] = useState<Comment[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const loadingRef = useRef(false)

  const load = async (next: string | null): Promise<void> => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(false)
    try {
      const page = await ipc.watchDialog(trackKey, root, anchor, next)
      setItems((prev) => (next === null ? page.items : [...prev, ...page.items]))
      setCursor(page.next)
      // B 站偶尔在最后一条之后还给一个 next_offset，下一页是空的。
      // 空页就当到底，否则「展开更多」点一下什么都不发生，按钮才消失。
      // B 站会在这条对话已经说完时照样给一个 next_offset，下一页是空的
      // （实测一条 5 条的对话：点「展开更多」多打一次请求、一条也没多）。
      // 满一页才认为可能还有下一页。
      setHasMore(page.has_more && page.items.length >= DIALOG_PAGE_SIZE)
    } catch {
      setError(true)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setItems([])
    setCursor(null)
    setHasMore(false)
    setError(false)
    void load(null)
    // load 依赖的参数都在这里，open 一变就重新取第一页。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackKey, root, anchor])

  return (
    <Modal open={open} title="对话" description={null} onClose={onClose} width="max-w-[560px]">
      <ul className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
        {items.map((c) => (
          <DialogRow
            key={c.id}
            c={c}
            ownerMid={ownerMid}
            onPhoto={onPhoto}
            onSeek={onSeek}
            onAuthorHover={onAuthorHover}
            onAuthorHide={onAuthorHide}
          />
        ))}
      </ul>
      {loading ? (
        <div className="mt-3">
          <BiliLoader compact label="正在取对话…" />
        </div>
      ) : null}
      {error ? (
        <div className="mt-3 text-[12px] text-[var(--text-3)]">
          <button
            type="button"
            onClick={() => void load(cursor)}
            className="t press text-[var(--accent)] hover:underline"
          >
            对话没取到，重试
          </button>
        </div>
      ) : null}
      {hasMore && !loading && !error ? (
        <button
          type="button"
          onClick={() => void load(cursor)}
          className="t press mt-3 text-[12px] text-[var(--accent)] hover:underline"
        >
          展开更多
        </button>
      ) : null}
      {!loading && items.length === 0 && !error ? (
        <p className="py-4 text-center text-[12px] text-[var(--text-3)]">这条对话没有更多内容。</p>
      ) : null}
    </Modal>
  )
}

export function CommentsPanel({
  trackKey,
  ownerMid = null,
  flow = false,
}: {
  trackKey: string
  ownerMid?: number | null
  flow?: boolean
}) {
  /** B 站那一对按钮：热度优先，还是时间优先。 */
  const [hot, setHot] = useState(loadCommentHot)
  /** 只看 UP 主本人发的评论；开发页用 `?onlyUp=1` 直接打开来验筛选。 */
  const [onlyUp, setOnlyUp] = useState(
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('onlyUp'),
  )
  const [items, setItems] = useState<Comment[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 被 B 站限流时记下重试时刻，到点自己再试一次。 */
  const [retry, setRetry] = useState<{ at: number } | null>(null)
  const [, setTick] = useState(0)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<{ id: string; root: string; author: string } | null>(null)
  /** 当前打开的对话分支：一级评论 + 分支里的二级评论。 */
  const [dialog, setDialog] = useState<{ root: string; anchor: string } | null>(null)
  /** 自己刚发的评论 rpid。只有这些能删，界面不会给别人的评论删按钮。 */
  const [mine, setMine] = useState<Set<string>>(new Set())
  /** 表情面板：代号 → 图片。第一次点开才取。 */
  const [emotes, setEmotes] = useState<[string, string][] | null>(null)
  /** 图挂了的代号。表情图来自远端，个别 404 时不该在面板里留一个碎图。 */
  const [brokenEmotes, setBrokenEmotes] = useState<ReadonlySet<string>>(new Set())
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [photo, setPhoto] = useState<{ pictures: string[]; index: number } | null>(null)

  useEffect(() => {
    if (!photo) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setPhoto(null)
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        setPhoto((current) => {
          if (!current) return current
          const delta = event.key === 'ArrowLeft' ? -1 : 1
          return {
            ...current,
            index: (current.index + delta + current.pictures.length) % current.pictures.length,
          }
        })
      }
    }
    // 捕获阶段先接：播放器的全局快捷键也会处理 Esc 与方向键。
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [photo])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  /** 下一批的游标；null 表示还没开始或已经到底。 */
  const cursorRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  /** 「只看 UP 主」已经自动补翻了几页；到上限就交回手动按钮。 */
  const scannedRef = useRef(0)
  const me = useAuthStore((s) => s.auth?.user ?? null)
  const authorHover = useAuthorHover()
  const visible = onlyUp && ownerMid !== null ? items.filter((c) => c.mid === ownerMid) : items
  const showAuthorCard = (c: Comment, el: HTMLElement): void => {
    if (c.mid <= 0) return
    authorHover.show(
      { mid: c.mid, name: c.author, face: c.avatar, sign: '', official: null, vip: false },
      el,
    )
  }

  useEffect(() => {
    if (replyTo) inputRef.current?.focus()
  }, [replyTo])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 32), 112)}px`
  }, [draft])

  useEffect(() => {
    if (!emojiOpen || emotes !== null) return
    let alive = true
    void ipc
      .commentEmotes()
      .then((list) => {
        if (alive) setEmotes(list)
      })
      .catch(() => {
        if (alive) setEmotes([])
      })
    return () => {
      alive = false
    }
  }, [emojiOpen, emotes])

  // 评论区跟着整页一起滚时不能再自己滚一屏，否则是「滚动里套滚动」。
  // 到底没有交给 IntersectionObserver：哨兵进入整页滚动容器的可视区就取下一页。
  useEffect(() => {
    if (!flow || onlyUp) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const root = sentinel.closest('[data-scroll-root]')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasMore && !loading) void load()
      },
      // 评论一页 20 条，提前几屏取下一页，滚起来才不会一顿一顿
      { root: root instanceof Element ? root : null, rootMargin: `${COMMENT_PREFETCH_PX}px` },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, hasMore, loading, trackKey, onlyUp])

  // 只看 UP 主时热门区前几页可能一条 UP 的都没有。自动补两页就够常见情况，
  // 再多就变成替用户刷接口了，剩下的交给「加载更多评论」。
  useEffect(() => {
    if (!onlyUp || loading || !hasMore || error || retry) return
    if (visible.length > 0 || scannedRef.current >= 2) return
    scannedRef.current += 1
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUp, loading, hasMore, visible.length, error, retry])

  const load = async (byHot = hot): Promise<void> => {
    if (loadingRef.current) return
    const seq = seqRef.current
    loadingRef.current = true
    setLoading(true)
    setError(null)
    setRetry(null)
    try {
      const res: CommentPage = await ipc.watchComments(trackKey, cursorRef.current, byHot)
      if (seq !== seqRef.current) return
      setItems((prev) => [...prev, ...res.items])
      setTotal(res.total)
      cursorRef.current = res.next
      setHasMore(res.next !== null)
    } catch (e) {
      const wire = toWireError(e)
      if (wire.class === 'rate_limited') {
        setRetry({ at: Date.now() + (wire.retry_after_ms ?? 60_000) })
      } else {
        setError(wire.message)
      }
    } finally {
      if (seq === seqRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }

  // 限流不是故障：到点自己重试一次，用户不用盯着倒计时去点按钮。
  useEffect(() => {
    if (!retry) return
    const timer = window.setInterval(() => {
      setTick((n) => n + 1)
      if (Date.now() < retry.at) return
      window.clearInterval(timer)
      void load(hot)
    }, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry, hot])

  useEffect(() => {
    seqRef.current += 1
    loadingRef.current = false
    scannedRef.current = 0
    setItems([])
    setReplyTo(null)
    setTotal(0)
    cursorRef.current = null
    setHasMore(false)
    void load(hot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey, hot])

  // 取回一页后缓冲还不够深就继续取；评论每页 20 条，一屏就能划完。
  // 跟着整页滚时量哨兵到窗口的距离，否则量面板自己的滚动位置。
  useEffect(() => {
    if (loading || !hasMore || onlyUp) return
    if (flow) {
      const mark = sentinelRef.current
      if (mark && mark.getBoundingClientRect().top < window.innerHeight + COMMENT_PREFETCH_PX) {
        void load()
      }
      return
    }
    const box = boxRef.current
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < COMMENT_PREFETCH_PX) {
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hasMore, loading, flow, onlyUp])

  const onScroll = (): void => {
    const box = boxRef.current
    if (!box || loading || !hasMore) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < COMMENT_PREFETCH_PX) void load()
  }

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      // 回复一级评论时 root 就是它自己；回楼中楼时要挂在原来的根下面。
      const target = replyTo
      // B 站会把「回复 @某人 :」写进正文，服务端不会替客户端补这一段。
      const body = target ? `回复 @${target.author} :${text}` : text
      const rpid = await ipc.commentAdd(trackKey, body, target?.root, target?.id)
      setDraft('')
      setReplyTo(null)
      setEmojiOpen(false)
      if (rpid) {
        setMine((prev) => new Set(prev).add(rpid))
        const numeric = (value: string): number => {
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : 0
        }
        const fresh: Comment = {
          id: rpid,
          root: numeric(target?.root ?? rpid),
          parent: numeric(target?.id ?? rpid),
          mid: me?.mid ?? 0,
          author: me?.uname ?? '我',
          avatar: me?.avatar ?? null,
          text: body,
          emotes: [],
          mentions: [],
          pictures: [],
          level: me?.level ?? 0,
          vip: false,
          likes: 0,
          at: Math.floor(Date.now() / 1000),
          replies: [],
          reply_count: 0,
          pinned: false,
          up_liked: false,
          liked: false,
          disliked: false,
          medal: null,
          location: null,
        }
        if (target) {
          // 回复挂回原楼：一级评论补预览，楼中楼只加根评论的回复数。
          const rootId = String(target.root)
          setItems((prev) =>
            prev.map((c) => {
              if (c.id !== rootId) return c
              const replies =
                target.id === target.root
                  ? [...c.replies, fresh].slice(0, 3)
                  : c.replies.map((r) =>
                      r.id === target.id ? { ...r, replies: [...r.replies, fresh].slice(0, 3) } : r,
                    )
              return { ...c, reply_count: c.reply_count + 1, replies }
            }),
          )
        } else {
          // 列表按热度排，刚发的没有热度，刷新也翻不到。直接插到顶部，
          // 用户才看得到自己刚发的东西，也才有地方删。
          setItems((prev) => [fresh, ...prev])
        }
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
      cursorRef.current = null
      setItems([])
      await load()
    } catch (e) {
      setError(toWireError(e).message)
    }
  }

  const seekToTime = (ms: number): void => {
    void ipc.playerSeek(ms).catch(() => {})
  }

  const composer = (reply: { id: string; author: string } | null): ReactNode => (
    <div>
      {reply ? (
        <div className="mb-1 flex items-center gap-1 text-[11px] text-[var(--text-3)]">
          <span className="min-w-0 truncate">回复 @{reply.author}</span>
          <button
            type="button"
            aria-label="取消回复"
            title="取消回复"
            onClick={() => setReplyTo(null)}
            className="t press flex h-5 w-5 items-center justify-center rounded-[3px] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)]"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && reply) {
              setReplyTo(null)
              return
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder={reply ? `回复 @${reply.author}` : '发一条评论'}
          aria-label={reply ? `回复 @${reply.author}` : '发评论'}
          className="max-h-28 min-h-8 min-w-0 flex-1 resize-none rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-[12px] leading-5 outline-none focus:border-[var(--accent)]"
        />
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="表情"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((open) => !open)}
            className={`t press flex h-8 w-8 items-center justify-center rounded-[6px] ${
              emojiOpen
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--accent)]'
            }`}
          >
            <Icon name="emoji" size={15} />
          </button>
          {emojiOpen ? (
            <div className="absolute bottom-10 right-0 z-30 w-[304px] rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-2 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.3)]">
              {emotes === null ? (
                <BiliLoader compact label="正在读表情…" />
              ) : emotes.length === 0 ? (
                <p className="px-2 py-3 text-[12px] text-[var(--text-3)]">表情没取到</p>
              ) : (
                <div className="grid max-h-[220px] grid-cols-8 gap-1 overflow-y-auto">
                  {emotes
                    .filter(([code]) => !brokenEmotes.has(code))
                    .map(([code, url]) => (
                      <button
                        key={code}
                        type="button"
                        title={code}
                        aria-label={code}
                        onClick={() => setDraft((draft) => draft + code)}
                        className="flex h-8 items-center justify-center rounded-[4px] hover:bg-[var(--panel-alt)]"
                      >
                        <img
                          src={url}
                          alt={code}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          onError={() =>
                            setBrokenEmotes((prev) => new Set(prev).add(code))
                          }
                          className="h-6 w-6 object-contain"
                        />
                      </button>
                    ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || sending}
          aria-label="发送"
          title="发送"
          className="t press flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--accent)] text-white disabled:opacity-40"
        >
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  )

  return (
    <div id="watch-comments" className={flow ? 'flex flex-col' : 'flex min-h-0 flex-col'}>
      <div className={`flex items-baseline gap-2 py-3 ${flow ? '' : 'px-3'}`}>
        <h3 className="text-[14px] font-medium">评论</h3>
        <span className="num text-[12px] text-[var(--text-3)]">
          {total > 0 ? formatCount(total) : '—'}
        </span>
        <div className="ml-auto flex items-center gap-1 text-[12px]">
          {ownerMid !== null ? (
            <button
              type="button"
              aria-pressed={onlyUp}
              onClick={() => setOnlyUp((value) => !value)}
              className={`t press mr-1 rounded-[4px] px-2 py-0.5 ${
                onlyUp
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
            >
              UP主
            </button>
          ) : null}
          {[
            { on: true, label: '最热' },
            { on: false, label: '最新' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={hot === option.on}
              onClick={() => {
                setHot(option.on)
                saveCommentHot(option.on)
              }}
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
      {replyTo ? null : (
        <div className={`border-b border-hairline pb-3 ${flow ? '' : 'px-3'}`}>
          {composer(null)}
        </div>
      )}
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
        {retry ? (
          <div className="py-6 text-center text-[12px] text-[var(--text-3)]">
            <p>
              B 站限流了，
              {Math.max(0, Math.ceil((retry.at - Date.now()) / 1000))} 秒后自动重试
            </p>
            <button
              type="button"
              onClick={() => {
                setRetry(null)
                void load()
              }}
              className="t press mt-2 rounded-[6px] border border-[var(--line)] px-3 py-1 hover:bg-[var(--panel-alt)]"
            >
              立即重试
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="py-6 text-center text-[12px] text-[var(--text-3)]">
            <p>评论没取到：{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="t press mt-2 rounded-[6px] border border-[var(--line)] px-3 py-1 hover:bg-[var(--panel-alt)]"
            >
              重试
            </button>
          </div>
        ) : null}
        <ul className="max-w-[880px] space-y-4" data-comment-list="root">
          {visible.map((c) => (
            <CommentRow
              key={c.id}
              c={c}
              trackKey={trackKey}
              ownerMid={ownerMid}
              onReply={(target) =>
                setReplyTo({
                  id: target.id,
                  root: target.root ? String(target.root) : target.id,
                  author: target.author,
                })
              }
              onDelete={mine.has(c.id) ? remove : undefined}
              deleteFor={(target) => (mine.has(target.id) ? remove : undefined)}
              onPhoto={(pictures, index) => setPhoto({ pictures, index })}
              onSeek={seekToTime}
              onAuthorHover={showAuthorCard}
              onAuthorHide={authorHover.hide}
              replyComposer={replyTo?.id === c.id ? composer(replyTo) : undefined}
              replyComposerFor={(target) =>
                replyTo?.id === target.id ? composer(replyTo) : undefined
              }
              onDialog={(target) => {
                if ((target.root ?? 0) > 0 && (target.dialog ?? 0) > 0) {
                  setDialog({ root: String(target.root), anchor: String(target.dialog) })
                }
              }}
            />
          ))}
          {onlyUp && !loading && !error && items.length > 0 && visible.length === 0 ? (
            <li className="py-6 text-center text-[12px] text-[var(--text-3)]">
              前几页还没有 UP 主本人的评论。
            </li>
          ) : null}
        </ul>
        {loading ? (
          <BiliLoader compact label="正在取评论…" />
        ) : null}
        {onlyUp && hasMore && !loading && !error && !retry ? (
          <button
            type="button"
            onClick={() => void load()}
            className="t press block mx-auto my-4 rounded-[6px] border border-[var(--line)] px-3 py-1 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)]"
          >
            加载更多评论
          </button>
        ) : null}
        {!loading && !hasMore && visible.length > 0 ? (
          <p className="py-3 text-center text-[11px] text-[var(--text-3)]">到底了</p>
        ) : null}
        {flow ? <div ref={sentinelRef} className="h-1" /> : null}
      </div>
      <DialogModal
        open={dialog !== null}
        trackKey={trackKey}
        ownerMid={ownerMid}
        root={dialog?.root ?? ''}
        anchor={dialog?.anchor ?? ''}
        onClose={() => setDialog(null)}
        onPhoto={(pictures, index) => setPhoto({ pictures, index })}
        onSeek={seekToTime}
        onAuthorHover={showAuthorCard}
        onAuthorHide={authorHover.hide}
      />
      <AuthorHoverCard
        hover={authorHover.hover}
        card={authorHover.card}
        onHide={authorHover.hide}
        onKeep={authorHover.keep}
        onOpen={(user) =>
          useAppStore.getState().navigate({ kind: 'author', name: user.name, mid: user.mid })
        }
      />
      {photo
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              onClick={() => setPhoto(null)}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6"
            >
              <button
                type="button"
                aria-label="关闭图片"
                title="关闭图片"
                onClick={(event) => {
                  event.stopPropagation()
                  setPhoto(null)
                }}
                className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/30 hover:bg-black/80"
              >
                <Icon name="close" size={18} />
              </button>
              {photo.pictures.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="上一张"
                    title="上一张"
                    onClick={(event) => {
                      event.stopPropagation()
                      setPhoto((current) =>
                        current
                          ? {
                              ...current,
                              index:
                                (current.index - 1 + current.pictures.length) %
                                current.pictures.length,
                            }
                          : current,
                      )
                    }}
                    className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/30 hover:bg-black/75"
                  >
                    <Icon name="chevronLeft" size={20} />
                  </button>
                  <button
                    type="button"
                    aria-label="下一张"
                    title="下一张"
                    onClick={(event) => {
                      event.stopPropagation()
                      setPhoto((current) =>
                        current
                          ? {
                              ...current,
                              index: (current.index + 1) % current.pictures.length,
                            }
                          : current,
                      )
                    }}
                    className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/30 hover:bg-black/75"
                  >
                    <Icon name="chevronRight" size={20} />
                  </button>
                  <span className="num absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-[12px] text-white/85 ui-audit-ok">
                    {photo.index + 1} / {photo.pictures.length}
                  </span>
                </>
              ) : null}
              <img
                src={photo.pictures[photo.index] ?? photo.pictures[0] ?? ''}
                alt=""
                referrerPolicy="no-referrer"
                onClick={(event) => event.stopPropagation()}
                className="max-h-full max-w-full rounded-[6px] object-contain"
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
