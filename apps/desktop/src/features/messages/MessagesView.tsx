import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import { useAuthStore } from '../auth/authStore'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatRelative } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliTvLoading } from '../../shared/ui/BiliTvLoading'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'

const CONTENT = 'mx-auto w-full max-w-[760px] px-4 md:px-6'
const TABS: { kind: ipc.MessageKind; label: string }[] = [
  { kind: 'reply', label: '回复我的' },
  { kind: 'at', label: '@我的' },
  { kind: 'like', label: '收到的赞' },
]

function MessageCard({ item }: { item: ipc.MessageItem }) {
  const navigate = useAppStore((state) => state.navigate)
  const first = item.users[0]
  const author = (user: ipc.MessageUser) => navigate({ kind: 'author', name: user.name, mid: user.mid })

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
                ? (item.count > 1 ? `等 ${formatCount(item.count)} 人赞了你的视频` : '赞了你的视频')
                : item.kind === 'reply' ? '回复了你' : '在评论中提到了你'}
            </span>
          </div>
          <time dateTime={new Date(item.at * 1000).toISOString()} className="text-[12px] text-[var(--text-3)]">
            {formatRelative(item.at)}
          </time>
          {item.quote && item.kind !== 'like' ? (
            <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-[var(--line)] pl-3 text-[14px] leading-[22px] text-[var(--text-2)]">
              {item.quote}
            </blockquote>
          ) : null}
          <button type="button" onClick={open} className="group mt-3 flex w-full items-center gap-3 rounded-[6px] bg-[var(--ga0)] p-2 text-left">
            <span className="block aspect-video w-28 shrink-0 overflow-hidden rounded-[4px] sm:w-36">
              <Cover cover={item.cover} title={item.title} width={144} className="h-full w-full" />
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

function MessageList({ kind }: { kind: ipc.MessageKind }) {
  const [items, setItems] = useState<ipc.MessageItem[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const request = useRef(0)

  const load = useCallback(async (next: number): Promise<void> => {
    if (pending.current) return
    pending.current = true
    const sequence = ++request.current
    setLoading(true)
    setError(null)
    try {
      const result = await ipc.messages(kind, next)
      if (sequence !== request.current) return
      setItems((prev) => next === 1 ? result.items : [...prev, ...result.items])
      setPage(result.page)
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
    void load(1)
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
          void load(page + 1)
        }
      }}
      className="min-h-0 flex-1 overflow-y-auto pb-10"
    >
      <div className={`${CONTENT} flex flex-col gap-3 py-5`}>
        {page === 0 && loading ? <BiliTvLoading label="正在取消息" /> : null}
        {error && items.length === 0 ? (
          <EmptyState icon="alert" title="消息没取到" detail={error} action={{ label: '重试', onClick: () => void load(1) }} />
        ) : null}
        {page > 0 && !loading && !error && items.length === 0 ? (
          <EmptyState icon="message" mascot="peek" title="还没有消息" action={{ label: '刷新', onClick: () => void load(1) }} />
        ) : null}
        {items.map((item) => <MessageCard key={item.id} item={item} />)}
        {items.length > 0 && (hasMore || error) ? (
          <div className="flex justify-center py-4">
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(page + 1)}
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

export function MessagesView() {
  const [kind, setKind] = useState<ipc.MessageKind>('reply')
  const auth = useAuthStore((state) => state.auth)
  const unread = useAppStore((state) => state.messageUnread)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)

  useEffect(() => {
    if (auth && !auth.logged_in) setAuthOpen(true)
  }, [auth?.logged_in, setAuthOpen])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--ga0)]">
      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--panel)] pt-5">
        <div className={CONTENT}>
          <h2 className="text-[20px] font-semibold text-[var(--text-1)]">消息中心</h2>
          <nav aria-label="消息分类" className="mt-3 flex gap-6">
            {TABS.map((tab) => (
              <button
                key={tab.kind}
                type="button"
                aria-current={kind === tab.kind ? 'page' : undefined}
                onClick={() => setKind(tab.kind)}
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
      {!auth ? <BiliTvLoading /> : auth.logged_in ? (
        <MessageList key={`${kind}:${auth.user?.mid}`} kind={kind} />
      ) : (
        <EmptyState icon="message" mascot="peek" title="登录后查看消息" action={{ label: '登录', onClick: () => setAuthOpen(true) }} />
      )}
    </div>
  )
}
