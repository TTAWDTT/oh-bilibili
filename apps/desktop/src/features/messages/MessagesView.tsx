import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type View } from '../../app/appStore'
import { DirectInbox } from './DirectInbox'
import { toastFailure } from '../../app/notice'
import { useAuthStore } from '../auth/authStore'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatRelative } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'

const CONTENT = 'mx-auto w-full max-w-[760px] px-4 md:px-6'
const TABS: { kind: ipc.MessageKind | 'direct'; label: string }[] = [
  { kind: 'direct', label: '私信' },
  { kind: 'reply', label: '回复我的' },
  { kind: 'at', label: '@我的' },
  { kind: 'like', label: '收到的赞' },
]

function MessageCard({ item, emotes }: { item: ipc.MessageItem; emotes: Map<string, string> }) {
  const navigate = useAppStore((state) => state.navigate)
  const first = item.users[0]
  const author = (user: { name: string; mid: number }) => navigate({ kind: 'author', name: user.name, mid: user.mid })

  const open = () => {
    if (item.bvid) {
      navigate({
        kind: 'watch',
        track: {
          key: item.bvid,
          title: item.title,
          artist: first?.name ?? '',
          cover: item.cover,
          duration_ms: null,
          up_avatar: first?.avatar ?? null,
          up_mid: first?.mid ?? null,
        },
      })
    } else {
      void ipc.openExternal(item.url).catch((cause) => toastFailure('打开链接', cause))
    }
  }

  return (
    <article className="rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 -space-x-4">
          {item.users.slice(0, item.kind === 'like' ? 3 : 1).map((user) => (
            <button
              key={user.mid}
              type="button"
              onClick={() => author(user)}
              aria-label={`进入 ${user.name} 的主页`}
              className="t press rounded-full ring-2 ring-[var(--panel)]"
            >
              <Avatar src={user.avatar} alt={user.name} size={40} />
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[14px] leading-6">
            {first ? (
              <button
                type="button"
                onClick={() => author(first)}
                className="max-w-full truncate font-medium text-[var(--text-1)] hover:text-[var(--accent)]"
              >
                {first.name}
              </button>
            ) : null}
            <span className="text-[var(--text-2)]">
              {item.kind === 'like'
                ? (item.count > 1 ? `等 ${formatCount(item.count)} 人赞了你` : '赞了你')
                : item.kind === 'reply' ? '回复了你' : '在评论中提到了你'}
            </span>
          </div>
          <time dateTime={new Date(item.at * 1000).toISOString()} className="text-[12px] text-[var(--text-3)]">
            {formatRelative(item.at)}
          </time>
          {item.quote && item.kind !== 'like' ? (
            <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-[var(--line)] pl-3 text-[14px] leading-[22px] text-[var(--text-2)]">
              {quoteNodes(item.quote, item.mentions, emotes, author)}
            </blockquote>
          ) : null}
          <button type="button" onClick={open} className="group mt-3 flex w-full items-center gap-3 rounded-[6px] bg-[var(--ga0)] p-2 text-left">
            <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-[4px] sm:w-36">
              <Cover cover={item.cover} title={item.title} width={144} className="h-full w-full" />
              {item.bvid ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white">
                    <Icon name="play" size={14} />
                  </span>
                </span>
              ) : null}
            </span>
            <span className="line-clamp-2 min-w-0 text-[14px] leading-[22px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
              {item.title}
            </span>
          </button>
        </div>
      </div>
    </article>
  )
}

function quoteNodes(text: string, mentions: ipc.MessageMention[], emotes: Map<string, string>, onMention: (mention: ipc.MessageMention) => void): React.ReactNode[] {
  if (mentions.length === 0 && emotes.size === 0) return [text]
  const users = [...mentions].sort((a, b) => b.name.length - a.name.length)
  const nodes: React.ReactNode[] = []
  let buffer = ''
  let index = 0
  const nextClose = new Int32Array(text.length).fill(-1)
  let close = -1
  for (let cursor = text.length - 1; cursor >= 0; cursor -= 1) {
    if (text[cursor] === ']') close = cursor
    nextClose[cursor] = close
  }
  const flush = (): void => {
    if (!buffer) return
    nodes.push(buffer)
    buffer = ''
  }

  while (index < text.length) {
    if (text[index] === '[') {
      const end = nextClose[index] ?? -1
      const code = end > index ? text.slice(index, end + 1) : ''
      const url = code ? emotes.get(code) : undefined
      if (url) {
        flush()
        nodes.push(
          <img
            key={index}
            src={url}
            alt={code}
            title={code}
            referrerPolicy="no-referrer"
            className="mx-[1px] inline-block h-[20px] w-auto align-[-4px]"
          />,
        )
        index = end + 1
        continue
      }
    }
    if (text[index] === '@') {
      const mention = users.find((user) => text.startsWith(user.name, index + 1))
      if (mention) {
        flush()
        nodes.push(
          <button
            key={index}
            type="button"
            onClick={() => onMention(mention)}
            className="t text-left text-[var(--accent)] hover:underline"
          >
            @{mention.name}
          </button>,
        )
        index += mention.name.length + 1
        continue
      }
    }
    buffer += text[index]
    index += 1
  }
  flush()
  return nodes
}

function MessageList({ kind, emotes }: { kind: ipc.MessageKind; emotes: Map<string, string> }) {
  const [items, setItems] = useState<ipc.MessageItem[]>([])
  const [page, setPage] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const request = useRef(0)

  const load = useCallback(async (nextCursor: string | null, next: number): Promise<void> => {
    if (pending.current) return
    pending.current = true
    const sequence = ++request.current
    setLoading(true)
    setError(null)
    try {
      const result = await ipc.messages(kind, nextCursor, next)
      if (sequence !== request.current) return
      setItems((prev) => next === 1 ? result.items : [...prev, ...result.items])
      setPage(result.page)
      setCursor(result.next_cursor)
      setHasMore(result.has_more)
    } catch (cause) {
      if (sequence !== request.current) return
      const failure = toWireError(cause)
      if (failure.class === 'needs_login') useAppStore.getState().setAuthOpen(true)
      setError(failure.message)
    } finally {
      if (sequence === request.current) {
        pending.current = false
        setLoading(false)
      }
    }
  }, [kind])

  useEffect(() => {
    void load(null, 1)
    return () => {
      request.current += 1
      pending.current = false
    }
  }, [load])

  return (
    <div
      id="scroll-main"
      onScroll={(event) => {
        const box = event.currentTarget
        if (hasMore && !loading && !error && box.scrollHeight - box.scrollTop - box.clientHeight < 600) {
          void load(cursor, page + 1)
        }
      }}
      className="min-h-0 flex-1 overflow-y-auto pb-10"
    >
      <div className={`${CONTENT} flex flex-col gap-3 py-5`}>
        {page === 0 && loading ? <BiliLoader label="正在取消息…" /> : null}
        {error && items.length === 0 ? (
          <EmptyState icon="alert" title="消息没取到" detail={error} action={{ label: '重试', onClick: () => void load(null, 1) }} />
        ) : null}
        {page > 0 && !loading && !error && items.length === 0 ? (
          <EmptyState icon="message" mascot="peek" title="还没有消息" action={{ label: '刷新', onClick: () => void load(null, 1) }} />
        ) : null}
        {items.map((item) => <MessageCard key={item.id} item={item} emotes={emotes} />)}
        {items.length > 0 && (hasMore || error) ? (
          <div className="flex justify-center py-4">
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(cursor, page + 1)}
              className="t press h-8 rounded-[4px] border border-[var(--line)] bg-[var(--panel)] px-4 text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
            >
              {loading ? '加载中' : error ? '没取到，重试' : '加载更多'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function MessagesView({ view }: { view: Extract<View, { kind: 'messages' }> }) {
  const kind = view.tab ?? 'reply'
  const replace = useAppStore((state) => state.replace)
  const goBack = useAppStore((state) => state.goBack)
  const fromAuthor = useAppStore((state) => state.history.at(-1)?.view.kind === 'author')
  const [emotePairs, setEmotePairs] = useState<[string, string][]>([])
  const emotes = useMemo(() => new Map(emotePairs), [emotePairs])
  const auth = useAuthStore((state) => state.auth)
  const accountMid = auth?.user?.mid
  const sameOwner = view.accountMid === undefined || view.accountMid === accountMid
  const unread = useAppStore((state) => state.messageUnread)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)

  useEffect(() => {
    void ipc.commentEmotes().then(setEmotePairs).catch(() => setEmotePairs([]))
  }, [])

  useEffect(() => {
    if (auth && !auth.logged_in) setAuthOpen(true)
  }, [auth?.logged_in, setAuthOpen])

  useEffect(() => {
    if (!view.peer || !auth) return
    if (!sameOwner) replace({ kind: 'messages', tab: 'direct' })
    else if (view.accountMid === undefined && accountMid) replace({ ...view, accountMid })
  }, [view, auth, accountMid, sameOwner, replace])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--ga0)]">
      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--panel)] pt-5">
        <div className={`messages-header-content ${kind === 'direct' ? 'mx-auto w-full max-w-[1120px] px-4 md:px-6' : CONTENT}`}>
          <div className="flex items-center gap-2">
            {fromAuthor && <button type="button" onClick={goBack} aria-label="返回个人空间" title="返回个人空间"
              className="press rounded p-1 hover:bg-[var(--ga0)]"><Icon name="chevronLeft" size={18} /></button>}
            <h2 className="text-[20px] font-semibold text-[var(--text-1)]">消息中心</h2>
          </div>
          <nav aria-label="消息分类" className="mt-3 flex flex-wrap gap-x-4 sm:gap-x-6">
            {TABS.map((tab) => (
              <button
                key={tab.kind}
                type="button"
                aria-label={tab.label}
                aria-current={kind === tab.kind ? 'page' : undefined}
                onClick={() => replace({ kind: 'messages', tab: tab.kind })}
                className={`t relative flex items-center gap-1.5 border-b-2 pb-3 text-[14px] ${kind === tab.kind ? 'border-[var(--accent)] font-medium text-[var(--accent)]' : 'border-transparent text-[var(--text-2)] hover:text-[var(--accent)]'}`}
              >
                {tab.label}
                {unread && unread[tab.kind] > 0 ? (
                  <span className="num rounded-full bg-[var(--accent-soft)] px-1.5 text-[11px] leading-[18px] text-[var(--accent)]">
                    {formatCount(unread[tab.kind])}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
      </header>
      {!auth ? <BiliLoader label="正在确认登录…" /> : auth.logged_in ? (
        kind === 'direct' && accountMid
          ? <DirectInbox key={accountMid} me={accountMid} selected={sameOwner ? view.peer : undefined}
              onSelect={(peer) => replace(peer ? { kind: 'messages', tab: 'direct', peer, accountMid } : { kind: 'messages', tab: 'direct' })} />
          : kind !== 'direct' && <MessageList key={`${kind}:${auth.user?.mid}`} kind={kind} emotes={emotes} />
      ) : (
        <EmptyState icon="message" mascot="peek" title="登录后查看消息" action={{ label: '登录', onClick: () => setAuthOpen(true) }} />
      )}
    </div>
  )
}
