import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import * as ipc from '../../shared/lib/ipc'
import type { Followed } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliTvLoading } from '../../shared/ui/BiliTvLoading'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'

const FEED = 'mx-auto w-full max-w-[700px] px-4 md:px-0'

function DynamicCard({
  item,
  onOpen,
  onAuthor,
  onExternal,
}: {
  item: ipc.DynamicItem
  onOpen: () => void
  onAuthor: () => void
  onExternal: () => void
}) {
  const text = item.text.trim() === item.title.trim() ? '' : item.text.trim()

  return (
    <article className="group rounded-[6px] bg-[var(--panel)] px-4 py-[18px] md:px-5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onAuthor}
          aria-label={`进入 ${item.author} 的主页`}
          className="t press shrink-0 rounded-full"
        >
          <Avatar src={item.face} alt={item.author} size={48} />
        </button>
        <div className="min-w-0 flex-1 pt-px">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onAuthor}
              className="t block max-w-full truncate text-left text-[15px] font-medium leading-[20px] text-[var(--text-1)] hover:text-[var(--accent)]"
            >
              {item.author}
            </button>
            {item.official != null ? (
              <span
                title={item.official === 1 ? '机构认证' : '个人认证'}
                className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white"
              >
                <Icon name="check" size={9} />
              </span>
            ) : null}
            {item.vip ? (
              <span className="shrink-0 rounded-[2px] bg-[var(--accent-soft)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
                大会员
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] leading-[16px] text-[var(--text-3)]">
            投稿了视频
            <span className="px-1">·</span>
            {item.pub_time}
          </p>
        </div>
        <button
          type="button"
          onClick={onExternal}
          aria-label="在浏览器打开"
          title="在浏览器打开"
          className="t press -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] opacity-0 hover:bg-[var(--panel-raised)] hover:text-[var(--accent)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Icon name="external" size={14} />
        </button>
      </div>

      <div className="ml-[60px] mt-3">
        {text ? (
          <p className="mb-3 line-clamp-6 whitespace-pre-wrap break-words text-[15px] leading-[24px] text-[var(--text-1)]">
            {text}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onOpen}
          className="group/video t flex w-full overflow-hidden rounded-[6px] bg-[var(--ga1)] text-left transition-colors duration-150 hover:bg-[var(--ga2)]"
        >
          <span
            className="relative w-[38%] max-w-[212px] min-w-[128px] shrink-0 overflow-hidden bg-[var(--ga2)]"
            style={{ aspectRatio: '16 / 9' }}
          >
            <Cover
              cover={item.cover}
              title={item.title}
              width={212}
              className="h-full w-full transition-transform duration-300 group-hover/video:scale-[1.03]"
            />
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition duration-150 group-hover/video:bg-black/10 group-hover/video:opacity-100"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white">
                <Icon name="play" size={16} />
              </span>
            </span>
            <span className="num absolute bottom-1.5 right-1.5 rounded-[2px] bg-black/65 px-1 text-[11px] leading-[15px] text-white">
              {formatDuration(item.duration_ms)}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col px-4 py-3">
            <span className="line-clamp-2 text-[15px] leading-[22px] text-[var(--text-1)] transition-colors group-hover/video:text-[var(--accent)]">
              {item.title}
            </span>
            <span className="num mt-auto flex items-center gap-3.5 pt-2 text-[12px] leading-[16px] text-[var(--text-3)]">
              <span className="flex items-center gap-1" aria-label={`播放 ${formatCount(item.views)}`}>
                <Icon name="play" size={12} />
                {formatCount(item.views)}
              </span>
              <span className="flex items-center gap-1" aria-label={`弹幕 ${formatCount(item.danmaku)}`}>
                <Icon name="danmaku" size={12} />
                {formatCount(item.danmaku)}
              </span>
            </span>
          </span>
        </button>
      </div>
    </article>
  )
}

export function DynamicView() {
  const navigate = useAppStore((state) => state.navigate)
  const [following, setFollowing] = useState<Followed[]>([])
  const [items, setItems] = useState<ipc.DynamicItem[]>([])
  const [offset, setOffset] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorAppend, setErrorAppend] = useState(false)
  const pending = useRef(false)
  const prefetchPages = useRef(0)

  const load = useCallback(async (next: string | null, append: boolean): Promise<void> => {
    if (pending.current) return
    pending.current = true
    if (!append) prefetchPages.current = 0
    setLoading(true)
    setError(null)
    try {
      const page = await ipc.dynamicFeed(next)
      setItems((prev) => {
        if (!append) return page.items
        const seen = new Set(prev.map((item) => item.id))
        return [...prev, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setOffset(page.offset)
      setHasMore(page.has_more)
      setLoaded(true)
    } catch (cause) {
      setError(toWireError(cause).message)
      setErrorAppend(append)
    } finally {
      pending.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(null, false)
  }, [load])

  useEffect(() => {
    void ipc
      .following(1)
      .then(([users]) => setFollowing(users))
      .catch(() => {})
  }, [])

  // 一页只有 20 条，滑两屏就断粮。首屏之后连补 4 页，把可视区之外垫到 100 条。
  useEffect(() => {
    if (!loaded || !hasMore || loading || error) return
    if (items.length === 0 || items.length >= 100 || prefetchPages.current >= 4) return
    prefetchPages.current += 1
    void load(offset, true)
  }, [loaded, hasMore, loading, error, items.length, offset, load])

  if (!loaded && loading) return <BiliTvLoading label="正在取动态" />
  if (error && items.length === 0) {
    return (
      <EmptyState
        icon="alert"
        title="动态没取到"
        detail={error}
        action={{ label: '重试', onClick: () => void load(null, false) }}
      />
    )
  }
  if (loaded && items.length === 0) {
    return (
      <EmptyState
        icon="biliTv"
        title="关注的人还没有新视频"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  return (
    <div
      id="scroll-main"
      onScroll={(event) => {
        if (!hasMore || loading || error || pending.current) return
        const box = event.currentTarget
        if (box.scrollHeight - box.scrollTop - box.clientHeight < 1800) {
          void load(offset, true)
        }
      }}
      className="min-h-0 flex-1 overflow-y-auto bg-[var(--ga0)] pb-10"
    >
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--panel)]">
        <div className={`${FEED} flex h-[56px] items-center`}>
          <h2 className="text-[20px] font-medium text-[var(--text-1)]">动态</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void ipc
                  .openExternal('https://t.bilibili.com/')
                  .catch((cause) => toastFailure('打开动态页', cause))
              }
              className="bili-press flex h-8 items-center gap-1 rounded-[4px] bg-[var(--accent)] px-3 text-[12px] text-white hover:opacity-90"
            >
              <Icon name="plus" size={13} />
              发布动态
            </button>
            <button
              type="button"
              onClick={() => void load(null, false)}
              disabled={loading}
              aria-label="刷新动态"
              title="刷新动态"
              className="t press flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-50"
            >
              <Icon name="refresh" size={15} />
            </button>
          </div>
        </div>
      </header>
      {following.length > 0 ? (
        <div className={`${FEED} pt-4`}>
          <div className="no-scrollbar flex gap-3.5 overflow-x-auto rounded-[6px] bg-[var(--panel)] px-4 py-3">
            {following.map((user) => (
              <button
                key={user.mid}
                type="button"
                onClick={() => navigate({ kind: 'author', name: user.name, mid: user.mid })}
                className="t press w-[64px] shrink-0 text-center"
              >
                <Avatar src={user.face} alt={user.name} size={48} />
                <span className="mt-1.5 block truncate text-[12px] leading-[16px] text-[var(--text-2)]">
                  {user.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={`${FEED} flex flex-col gap-3 pt-4`}>
        {items.map((item) => (
          <DynamicCard
            key={item.id}
            item={item}
            onOpen={() =>
              navigate({
                kind: 'watch',
                track: {
                  key: item.bvid,
                  title: item.title,
                  artist: item.author,
                  cover: item.cover,
                  duration_ms: item.duration_ms,
                  views: item.views,
                  danmaku: item.danmaku,
                  up_avatar: item.face,
                  up_mid: item.mid,
                },
              })
            }
            onAuthor={() => navigate({ kind: 'author', name: item.author, mid: item.mid })}
            onExternal={() => {
              void ipc
                .openExternal(`https://www.bilibili.com/video/${item.bvid}`)
                .catch((cause) => toastFailure('打开链接', cause))
            }}
          />
        ))}
        {error && items.length > 0 ? (
          <div className="flex justify-center py-5">
            <button
              type="button"
              onClick={() => void load(errorAppend ? offset : null, errorAppend)}
              className="t press text-[13px] text-[var(--accent)] hover:underline"
            >
              没取到，重试
            </button>
          </div>
        ) : loading ? (
          <BiliLoader compact label="正在加载动态…" />
        ) : hasMore ? null : (
          <p className="py-6 text-center text-[12px] text-[var(--text-3)]">没有更多了</p>
        )}
      </div>
    </div>
  )
}
