import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useAppStore } from '../../app/appStore'
import type { DynamicReturn, DynamicTab } from '../../app/appStore'
import { toastDone, toastFailure } from '../../app/notice'
import * as ipc from '../../shared/lib/ipc'
import type { Followed } from '../../shared/lib/contract'
import { useAuthStore } from '../auth/authStore'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { AuthorHoverCard, useAuthorHover } from '../../shared/ui/AuthorHoverCard'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'

const FEED = 'mx-auto w-full max-w-[700px] px-4 md:px-0'
const TABS: { key: DynamicTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'video', label: '视频投稿' },
  { key: 'opus', label: '图文' },
]

type DynamicOpenEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
type OpenDynamic = (event: DynamicOpenEvent) => void
type OpenDynamicItem = (item: ipc.DynamicItem, event: DynamicOpenEvent) => void
type DynamicBody = { id: string; initiallyExpanded: boolean }

/** 动态正文：超过六行折起来，B 站卡片也是先露出前几行再给「展开」。 */
function RichText({ text, body }: { text: string; body: DynamicBody }) {
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)
  const [expanded, setExpanded] = useState(body.initiallyExpanded)
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
          name="dynamic-body"
          value={body.id}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="t mt-1 text-[13px] text-[var(--accent)] hover:underline"
        >
          {expanded ? '收起' : '展开'}
        </button>
      ) : null}
    </div>
  )
}

function DynamicVideo({ item, onOpen }: { item: ipc.DynamicItem; onOpen: OpenDynamic }) {
  const later = (event: MouseEvent): void => {
    event.stopPropagation()
    if (!item.bvid) return
    void ipc
      .watchLaterSet(item.bvid, true)
      .then(() => toastDone('已加入稍后再看'))
      .catch((cause) => toastFailure('稍后再看', cause))
  }

  return (
    <div
      role="button"
      data-dynamic-open="video"
      tabIndex={0}
      onClick={(event) => {
        // 封面右下角的「稍后再看」自己处理点击，别让整卡跟着进视频。
        if ((event.target as HTMLElement).closest('button')) return
        event.stopPropagation()
        onOpen(event)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        event.stopPropagation()
        onOpen(event)
      }}
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
        <span className="num absolute bottom-1.5 right-1.5 rounded-[2px] bg-black/65 px-1 text-[11px] leading-[15px] text-white transition-opacity group-hover/video:opacity-0">
          {formatDuration(item.duration_ms)}
        </span>
        {/* B 站动态里的视频卡：悬停时右下角的时长换成「稍后再看」。 */}
        <button
          type="button"
          onClick={later}
          aria-label="稍后再看"
          title="稍后再看"
          className="t absolute bottom-1.5 right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-black/65 text-white opacity-0 transition-opacity duration-150 hover:bg-[var(--accent)] focus-visible:opacity-100 group-hover/video:opacity-100"
        >
          <Icon name="watchLater" size={12} />
        </button>
      </span>
      <span className="flex min-w-0 flex-1 flex-col px-4 py-3">
        <span className="line-clamp-2 text-[15px] leading-[22px] text-[var(--text-1)] transition-colors group-hover/video:text-[var(--accent-strong-hover)]">
          {item.title}
        </span>
        <span className="num mt-auto flex items-center gap-3.5 pt-2 text-[12px] leading-[16px] text-[var(--text-2)]">
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
    </div>
  )
}

/** 专栏投稿：B 站动态里是左边标题摘要、右边封面，底下挂「专栏」。 */
function DynamicArticle({ item, onOpen }: { item: ipc.DynamicItem; onOpen: OpenDynamic }) {
  const text = item.text.trim()
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/read t flex w-full gap-3 rounded-[6px] bg-[var(--ga1)] p-3 text-left transition-colors duration-150 hover:bg-[var(--ga2)]"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-[15px] font-medium leading-[22px] text-[var(--text-1)] transition-colors group-hover/read:text-[var(--accent-strong-hover)]">
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
function DynamicLive({ item, onOpen }: { item: ipc.DynamicItem; onOpen: OpenDynamic }) {
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
        <span className="line-clamp-2 text-[14px] leading-[21px] text-[var(--text-1)] transition-colors group-hover/live:text-[var(--accent-strong-hover)]">
          {item.title}
        </span>
        <span className="mt-1 truncate text-[12px] text-[var(--text-2)]">{item.live_area}</span>
        <span className="num mt-auto text-[12px] text-[var(--text-2)]">
          {formatCount(item.views)} 人气
        </span>
      </span>
    </button>
  )
}

function DynamicContent({
  item,
  body,
  onOpen,
}: {
  item: ipc.DynamicItem
  body: DynamicBody
  onOpen: OpenDynamic
}) {
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
      {text ? <RichText text={text} body={body} /> : null}
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
function OrigCard({
  orig,
  body,
  onOpenVideo,
}: {
  orig: ipc.DynamicItem
  body: DynamicBody
  onOpenVideo: OpenDynamicItem
}) {
  const navigate = useAppStore((state) => state.navigate)
  const open: OpenDynamic = (event) => {
    if (orig.kind === 'video' && orig.bvid) {
      onOpenVideo(orig, event)
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
      data-dynamic-open="forward"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        open(event)
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
        open(event)
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
          <span className="truncate text-[13px] text-[var(--text-2)] hover:text-[var(--accent-strong-hover)]">
            {orig.author}
          </span>
        </button>
        <span className="num ml-auto shrink-0 text-[11px] text-[var(--text-2)]">
          {orig.pub_time}
        </span>
      </div>
      <DynamicContent item={orig} body={body} onOpen={open} />
    </div>
  )
}

function DynamicCard({
  item,
  expandedBodies,
  onOpen,
  onAuthor,
  onExternal,
}: {
  item: ipc.DynamicItem
  expandedBodies: readonly string[]
  onOpen: OpenDynamicItem
  onAuthor: () => void
  onExternal: () => void
}) {
  const body = { id: item.id, initiallyExpanded: expandedBodies.includes(item.id) }
  const originalId = `${item.id}/original`
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
    <article
      data-dynamic-id={item.id}
      tabIndex={-1}
      className="group rounded-[6px] bg-[var(--panel)] px-4 py-[18px] md:px-5"
    >
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
              className="t block max-w-full truncate text-left text-[15px] font-medium leading-[20px] text-[var(--text-1)] hover:text-[var(--accent-strong-hover)]"
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
            {item.pub_time ? (
              <>
                <span className="px-1">·</span>
                {item.pub_time}
              </>
            ) : null}
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
            {text ? <RichText text={text} body={body} /> : null}
            {item.orig ? (
              <OrigCard
                orig={item.orig}
                body={{ id: originalId, initiallyExpanded: expandedBodies.includes(originalId) }}
                onOpenVideo={onOpen}
              />
            ) : null}
          </>
        ) : (
          <DynamicContent item={item} body={body} onOpen={(event) => onOpen(item, event)} />
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

function restoreDynamicPosition(scroller: HTMLElement, position: DynamicReturn): void {
  const cards = [...scroller.querySelectorAll<HTMLElement>('[data-dynamic-id]')]
  const byId = new Map(cards.map((card) => [card.dataset.dynamicId, card]))
  const original = byId.get(position.itemIds[position.index])
  let card = original
  for (let distance = 1; !card && distance < position.itemIds.length; distance += 1) {
    card = byId.get(position.itemIds[position.index + distance])
      ?? byId.get(position.itemIds[position.index - distance])
  }
  card ??= cards[Math.min(position.index, cards.length - 1)]
  if (!card) return

  const selector = original ? `[data-dynamic-open="${position.trigger}"]` : '[data-dynamic-open]'
  const target = card.querySelector<HTMLElement>(selector) ?? card
  scroller.scrollTop += target.getBoundingClientRect().top
    - scroller.getBoundingClientRect().top
    - position.top
  if (!original || position.restoreFocus) target.focus({ preventScroll: true })
}

export function DynamicView() {
  const navigate = useAppStore((state) => state.navigate)
  const dynamicReturn = useAppStore((state) => state.dynamicReturn)
  const [returnPosition, setReturnPosition] = useState(dynamicReturn)
  const loadedPages = useRef(0)
  const auth = useAuthStore((state) => state.auth)
  const me = auth?.logged_in ? auth.user : null
  const [following, setFollowing] = useState<Followed[] | null>(null)
  const authorHover = useAuthorHover()
  const [items, setItems] = useState<ipc.DynamicItem[]>([])
  const [tab, setTab] = useState<DynamicTab>(dynamicReturn?.tab ?? 'all')
  const [offset, setOffset] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorAppend, setErrorAppend] = useState(false)
  const pending = useRef(false)
  const prefetchPages = useRef(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const expandedBodies = returnPosition?.expandedBodies ?? []
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
      loadedPages.current = append ? loadedPages.current + 1 : 1
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
      .catch(() => setFollowing([]))
  }, [])

  // 一页只有 20 条，滑两屏就断粮。首屏之后连补 4 页，把可视区之外垫到 100 条。
  useEffect(() => {
    if (!loaded || !hasMore || loading || error) return
    if (loadedPages.current >= (returnPosition?.pages ?? 0)) {
      if (items.length === 0 || items.length >= 100 || prefetchPages.current >= 4) return
      prefetchPages.current += 1
    }
    void load(offset, true)
  }, [loaded, hasMore, loading, error, items.length, offset, load, returnPosition])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!returnPosition || !scroller || !loaded || following === null) return
    if (!error && hasMore && loadedPages.current < returnPosition.pages) return
    const frame = requestAnimationFrame(() => {
      restoreDynamicPosition(scroller, returnPosition)
      setReturnPosition(undefined)
    })
    return () => cancelAnimationFrame(frame)
  }, [loaded, items, following, hasMore, error, returnPosition])

  const openVideo = (item: ipc.DynamicItem, event: DynamicOpenEvent, index: number): void => {
    const scroller = scrollerRef.current
    const target = event.currentTarget
    const position: DynamicReturn | undefined = scroller
      ? {
          tab,
          itemIds: visible.map((entry) => entry.id),
          index,
          expandedBodies: Array.from(
            scroller.querySelectorAll<HTMLButtonElement>('button[name="dynamic-body"][aria-expanded="true"]'),
            (button) => button.value,
          ),
          top: target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
          trigger: target.dataset.dynamicOpen === 'forward' ? 'forward' : 'video',
          restoreFocus: event.type === 'keydown',
          pages: loadedPages.current,
        }
      : undefined
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
    }, position)
  }

  if (!loaded && loading) return <BiliLoader label="正在取动态…" />
  if (error && items.length === 0) {
    return (
      <EmptyState
        icon="alert"
        mascot="hug"
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
        mascot="missYou"
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
        authorHover.hide()
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
              onClick={() => {
                setReturnPosition(undefined)
                void load(null, false)
              }}
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
          <nav aria-label="动态分类" className="flex gap-6">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setReturnPosition(undefined)
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
      <div className={`${FEED} pt-4`}>
        <button
          type="button"
          onClick={() =>
            void ipc
              .openExternal('https://t.bilibili.com/')
              .catch((cause) => toastFailure('打开发布页', cause))
          }
          aria-label="发布动态"
          title="在 B 站发布动态"
          className="group flex w-full items-center gap-3 rounded-[6px] bg-[var(--panel)] px-4 py-3 text-left"
        >
          <Avatar src={me?.avatar ?? null} alt={me?.uname ?? '我'} size={44} />
          <span className="min-w-0 flex-1 truncate rounded-[6px] bg-[var(--ga1)] px-3 py-2 text-[14px] text-[var(--text-3)] transition-colors group-hover:bg-[var(--ga2)] group-hover:text-[var(--text-2)]">
            分享新鲜事…
          </span>
          <span className="shrink-0 rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[13px] text-white transition-opacity group-hover:opacity-90">
            发布
          </span>
        </button>
      </div>
      {following?.length ? (
        <div className={`${FEED} pt-4`}>
          <div
            onScroll={authorHover.hide}
            className="no-scrollbar flex gap-3.5 overflow-x-auto rounded-[6px] bg-[var(--panel)] px-4 py-3"
          >
            {following.map((user) => (
              <button
                key={user.mid}
                type="button"
                onClick={() => {
                  authorHover.hide()
                  navigate({ kind: 'author', name: user.name, mid: user.mid })
                }}
                onPointerEnter={(event) => authorHover.show(user, event.currentTarget)}
                onPointerLeave={authorHover.hide}
                onFocus={(event) => authorHover.show(user, event.currentTarget)}
                onBlur={authorHover.hide}
                className="t press w-[64px] shrink-0 text-center"
              >
                <span className="relative inline-flex">
                  <Avatar src={user.face} alt={user.name} size={48} />
                  {user.special ? (
                    <span
                      title="特别关注"
                      className="absolute -right-0.5 -top-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[var(--panel)] text-[#ffb027]"
                    >
                      <Icon name="star" size={11} />
                    </span>
                  ) : null}
                </span>
                <span className="mt-1.5 block truncate text-[12px] leading-[16px] text-[var(--text-2)]">
                  {user.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <AuthorHoverCard
        hover={authorHover.hover}
        card={authorHover.card}
        onHide={authorHover.hide}
        onKeep={authorHover.keep}
        onOpen={(user) => {
          authorHover.hide()
          navigate({ kind: 'author', name: user.name, mid: user.mid })
        }}
      />
      <div className={`${FEED} flex flex-col gap-3 pt-4`}>
        {visible.map((item, index) => (
          <DynamicCard
            key={item.id}
            item={item}
            expandedBodies={expandedBodies}
            onOpen={(opened, event) => {
              if (opened.kind === 'video' && opened.bvid) {
                openVideo(opened, event, index)
              } else if (opened.kind === 'article' && opened.article_id) {
                void ipc
                  .openExternal(`https://www.bilibili.com/read/cv${opened.article_id}`)
                  .catch((cause) => toastFailure('打开专栏', cause))
              } else if (opened.kind === 'live' && opened.room_id) {
                void ipc
                  .openExternal(`https://live.bilibili.com/${opened.room_id}`)
                  .catch((cause) => toastFailure('打开直播间', cause))
              } else if (opened.kind !== 'video') {
                void ipc
                  .openExternal(`https://www.bilibili.com/opus/${opened.id}`)
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
