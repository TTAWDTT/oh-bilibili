import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
const TABS: { key: 'all' | 'video' | 'opus'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'video', label: '视频投稿' },
  { key: 'opus', label: '图文' },
]

/** 动态正文：超过六行折起来，B 站卡片也是先露出前几行再给「展开」。 */
function RichText({ text }: { text: string }) {
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const bodyNodes = text.split(/(#[^#\s]{1,40}#)/g).map((part, index) => {
    if (!part.startsWith('#') || !part.endsWith('#') || part.length < 3) return part
    return (
      <button
        key={index}
        type="button"
        onClick={() => setHeroQuery(part.slice(1, -1))}
        className="t text-left text-[var(--accent)] hover:underline"
      >
        {part}
      </button>
    )
  })

  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = (): void => {
      if (expanded) return
      setOverflow(element.scrollHeight > element.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div className="mb-3">
      <p
        ref={textRef}
        className={`whitespace-pre-wrap break-words text-[15px] leading-[24px] text-[var(--text-1)] ${expanded ? '' : 'line-clamp-6'}`}
      >
        {bodyNodes}
      </p>
      {overflow || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="t mt-1 text-[13px] text-[var(--accent)] hover:underline"
        >
          {expanded ? '收起' : '展开'}
        </button>
      ) : null}
    </div>
  )
}

function DynamicVideo({ item, onOpen }: { item: ipc.DynamicItem; onOpen: () => void }) {
  return (
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
  )
}

/** 专栏投稿：B 站动态里是左边标题摘要、右边封面，底下挂「专栏」。 */
function DynamicArticle({ item, onOpen }: { item: ipc.DynamicItem; onOpen: () => void }) {
  const text = item.text.trim()
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/read t flex w-full gap-3 rounded-[6px] bg-[var(--ga1)] p-3 text-left transition-colors duration-150 hover:bg-[var(--ga2)]"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-[15px] font-medium leading-[22px] text-[var(--text-1)] transition-colors group-hover/read:text-[var(--accent)]">
          {item.title}
        </span>
        {text ? (
          <span className="mt-1 line-clamp-2 text-[13px] leading-[19px] text-[var(--text-2)]">{text}</span>
        ) : null}
        <span className="mt-auto pt-2">
          <span className="rounded-[2px] bg-[var(--accent-soft)] px-1 text-[11px] leading-[16px] text-[var(--accent)]">
            专栏
          </span>
        </span>
      </span>
      {item.cover ? (
        <span className="h-[100px] w-[100px] shrink-0 overflow-hidden rounded-[4px] bg-[var(--ga2)]">
          <Cover cover={item.cover} title={item.title} width={100} className="h-full w-full" />
        </span>
      ) : null}
    </button>
  )
}

/** 关注流里夹的直播推荐卡。B 站把它画成普通直播封面 + 主播 + 分区。 */
function DynamicLive({ item, onOpen }: { item: ipc.DynamicItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/live t flex w-full gap-3 rounded-[6px] bg-[var(--ga1)] p-3 text-left transition-colors duration-150 hover:bg-[var(--ga2)]"
    >
      <span
        className="relative w-[168px] shrink-0 overflow-hidden rounded-[4px]"
        style={{ aspectRatio: '16 / 10' }}
      >
        <Cover cover={item.cover} title={item.title} width={168} className="h-full w-full" />
        <span className="absolute left-1 top-1 rounded-[2px] bg-[var(--accent)] px-1 text-[10px] font-medium leading-[15px] text-white">
          LIVE
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-[14px] leading-[21px] text-[var(--text-1)] transition-colors group-hover/live:text-[var(--accent)]">
          {item.title}
        </span>
        <span className="mt-1 truncate text-[12px] text-[var(--text-3)]">{item.live_area}</span>
        <span className="num mt-auto text-[12px] text-[var(--text-3)]">
          {formatCount(item.views)} 人气
        </span>
      </span>
    </button>
  )
}

function DynamicContent({ item, onOpen }: { item: ipc.DynamicItem; onOpen: () => void }) {
  const text =
    item.kind === 'video' && item.text.trim() === item.title.trim() ? '' : item.text.trim()
  if (item.kind === 'article') return <DynamicArticle item={item} onOpen={onOpen} />
  if (item.kind === 'live') return <DynamicLive item={item} onOpen={onOpen} />
  return (
    <>
      {item.kind === 'opus' && item.title ? (
        <p className="mb-2 break-words text-[15px] font-medium leading-[24px] text-[var(--text-1)]">
          {item.title}
        </p>
      ) : null}
      {text ? <RichText text={text} /> : null}
      {item.kind === 'video' ? <DynamicVideo item={item} onOpen={onOpen} /> : null}
      {item.kind === 'opus' && item.images.length > 0 ? (
        <div
          className={`grid gap-1.5 ${item.images.length === 1 ? 'grid-cols-1' : item.images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
        >
          {item.images.slice(0, 9).map((url, index) => (
            <button
              key={`${url}-${index}`}
              type="button"
              onClick={onOpen}
              aria-label={`打开第 ${index + 1} 张图片`}
              className={`t relative flex items-center justify-center overflow-hidden rounded-[6px] bg-[var(--ga1)] ${item.images.length === 1 ? 'min-h-[180px]' : 'aspect-square'}`}
            >
              <Icon name="biliTv" size={22} className="absolute text-[var(--ga3)]" />
              <img
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className={`relative w-full object-cover ${item.images.length === 1 ? 'max-h-[320px]' : 'h-full'}`}
                onError={(event) => {
                  event.currentTarget.style.display = 'none'
                }}
              />
              {index === 8 && item.images.length > 9 ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[24px] font-medium text-white">
                  +{item.images.length - 9}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** 转发动态里被转的那条。再套转发只画到这里，不再往下一层。 */
function OrigCard({ orig }: { orig: ipc.DynamicItem }) {
  const navigate = useAppStore((state) => state.navigate)
  const open = (): void => {
    if (orig.kind === 'video' && orig.bvid) {
      navigate({
        kind: 'watch',
        track: {
          key: orig.bvid,
          title: orig.title,
          artist: orig.author,
          cover: orig.cover,
          duration_ms: orig.duration_ms,
          views: orig.views,
          danmaku: orig.danmaku,
          up_avatar: orig.face,
          up_mid: orig.mid,
        },
      })
    } else if (orig.kind === 'article' && orig.article_id) {
      void ipc
        .openExternal(`https://www.bilibili.com/read/cv${orig.article_id}`)
        .catch((cause) => toastFailure('打开专栏', cause))
    } else if (orig.kind === 'live' && orig.room_id) {
      void ipc
        .openExternal(`https://live.bilibili.com/${orig.room_id}`)
        .catch((cause) => toastFailure('打开直播间', cause))
    } else {
      void ipc
        .openExternal(`https://www.bilibili.com/opus/${orig.id}`)
        .catch((cause) => toastFailure('打开原动态', cause))
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        open()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        // 内层按钮自己要处理键盘：冒泡上来再整卡打开会抢掉它的动作。
        if (
          event.target !== event.currentTarget &&
          (event.target as HTMLElement).closest('button')
        ) {
          return
        }
        event.preventDefault()
        open()
      }}
      className="mt-1 cursor-pointer rounded-[6px] border border-[var(--line)] bg-[var(--ga1)] p-3 transition-colors duration-150 hover:bg-[var(--ga2)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate({ kind: 'author', name: orig.author, mid: orig.mid })}
          className="t flex min-w-0 items-center gap-2"
        >
          <Avatar src={orig.face} alt={orig.author} size={24} />
          <span className="truncate text-[13px] text-[var(--text-2)] hover:text-[var(--accent)]">
            {orig.author}
          </span>
        </button>
        <span className="num ml-auto shrink-0 text-[11px] text-[var(--text-3)]">
          {orig.pub_time}
        </span>
      </div>
      <DynamicContent item={orig} onOpen={open} />
    </div>
  )
}

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
  const text =
    item.kind === 'video' && item.text.trim() === item.title.trim() ? '' : item.text.trim()
  const kindLabel =
    item.kind === 'video'
      ? '投稿了视频'
      : item.kind === 'forward'
        ? '转发了动态'
        : item.kind === 'article'
          ? '投稿了专栏'
          : item.kind === 'live'
            ? '正在直播'
          : '发布了动态'

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
            {kindLabel}
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
        {item.kind === 'forward' ? (
          <>
            {text ? <RichText text={text} /> : null}
            {item.orig ? <OrigCard orig={item.orig} /> : null}
          </>
        ) : (
          <DynamicContent item={item} onOpen={onOpen} />
        )}
      </div>
      <footer className="ml-[60px] mt-3 flex items-center gap-6 text-[12px] leading-[16px] text-[var(--text-3)]">
        <span className="flex items-center gap-1.5" title={`转发 ${formatCount(item.forwards)}`}>
          <Icon name="share" size={15} />
          {formatCount(item.forwards)}
        </span>
        <span className="flex items-center gap-1.5" title={`评论 ${formatCount(item.comments)}`}>
          <Icon name="message" size={15} />
          {formatCount(item.comments)}
        </span>
        <span className="flex items-center gap-1.5" title={`点赞 ${formatCount(item.likes)}`}>
          <Icon name="thumb" size={15} />
          {formatCount(item.likes)}
        </span>
      </footer>
    </article>
  )
}

export function DynamicView() {
  const navigate = useAppStore((state) => state.navigate)
  const [following, setFollowing] = useState<Followed[]>([])
  const [items, setItems] = useState<ipc.DynamicItem[]>([])
  const [tab, setTab] = useState<'all' | 'video' | 'opus'>('all')
  const [offset, setOffset] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorAppend, setErrorAppend] = useState(false)
  const pending = useRef(false)
  const prefetchPages = useRef(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const visible =
    tab === 'all'
      ? items
      : items.filter(
          (item) => item.kind === tab || (tab === 'opus' && item.kind === 'article'),
        )

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
      if (!append) scrollerRef.current?.scrollTo({ top: 0 })
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
      ref={scrollerRef}
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
        <div className={FEED}>
          <nav aria-label="动态分类" className="flex gap-6 border-t border-[var(--hairline)]">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setTab(entry.key)
                  scrollerRef.current?.scrollTo({ top: 0 })
                }}
                className={`t border-b-2 py-2 text-[14px] ${
                  tab === entry.key
                    ? 'border-[var(--accent)] font-medium text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-2)] hover:text-[var(--accent)]'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </nav>
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
        {visible.map((item) => (
          <DynamicCard
            key={item.id}
            item={item}
            onOpen={() => {
              if (item.kind === 'video' && item.bvid) {
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
              } else if (item.kind === 'article' && item.article_id) {
                void ipc
                  .openExternal(`https://www.bilibili.com/read/cv${item.article_id}`)
                  .catch((cause) => toastFailure('打开专栏', cause))
              } else if (item.kind === 'live' && item.room_id) {
                void ipc
                  .openExternal(`https://live.bilibili.com/${item.room_id}`)
                  .catch((cause) => toastFailure('打开直播间', cause))
              } else if (item.kind !== 'video') {
                void ipc
                  .openExternal(`https://www.bilibili.com/opus/${item.id}`)
                  .catch((cause) => toastFailure('打开动态', cause))
              }
            }}
            onAuthor={() => navigate({ kind: 'author', name: item.author, mid: item.mid })}
            onExternal={() => {
              void ipc
                .openExternal(
                  item.kind === 'video'
                    ? `https://www.bilibili.com/video/${item.bvid}`
                    : item.kind === 'article' && item.article_id
                      ? `https://www.bilibili.com/read/cv${item.article_id}`
                      : item.kind === 'live' && item.room_id
                        ? `https://live.bilibili.com/${item.room_id}`
                        : `https://www.bilibili.com/opus/${item.id}`,
                )
                .catch((cause) => toastFailure('打开链接', cause))
            }}
          />
        ))}
        {visible.length === 0 && items.length > 0 && !loading && !hasMore && !error ? (
          <p className="rounded-[6px] bg-[var(--panel)] py-10 text-center text-[13px] text-[var(--text-3)]">
            这个分类还没有动态
          </p>
        ) : null}
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
