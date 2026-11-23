import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuthStore } from '../auth/authStore'
import { cachedFollowing } from '../library/followingIndex'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import type { DynamicReturn, DynamicTab } from '../../app/appStore'
import { toastDone, toastFailure } from '../../app/notice'
import * as ipc from '../../shared/lib/ipc'
import type { Followed } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { AuthorHoverCard, useAuthorHover } from '../../shared/ui/AuthorHoverCard'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'

/** 阅读列：信息流本身保持窄列，读起来不横跨整屏。 */
const FEED = 'mx-auto w-full max-w-[700px] px-4 md:px-0'
/** 页标题与分类沿用公共页边距，跟关注、周刊落在同一条左缘（#258）。 */
const HEADER = 'px-4 md:px-8'
/** 信息流在宽窗右侧让出作者筛选列，所以外层比 FEED 宽一点。 */
const FEED_WIDE = 'mx-auto w-full max-w-[980px] px-4 md:px-8'
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
        className={`whitespace-pre-wrap break-words text-reading-body text-[var(--text-1)] ${expanded ? '' : 'line-clamp-6'}`}
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

function DynamicVideo({
  item,
  onOpen,
  attribution,
}: {
  item: ipc.DynamicItem
  onOpen: OpenDynamic
  /** 引用视频时把被引作者的入口收进落款，标题下紧跟着「UP 乙」。 */
  attribution?: ReactNode
}) {
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
        <span className="line-clamp-2 break-words text-work-name text-[var(--text-1)] transition-colors group-hover/video:text-[var(--accent-strong-hover)]">
          {item.title}
        </span>
        {attribution ?? null}
        <span className="num mt-auto flex items-center gap-3.5 pt-2 text-page-meta text-[var(--text-2)]">
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
        <span className="line-clamp-2 break-words text-work-name text-[var(--text-1)] transition-colors group-hover/read:text-[var(--accent-strong-hover)]">
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
  attribution,
}: {
  item: ipc.DynamicItem
  body: DynamicBody
  onOpen: OpenDynamic
  /** 引用视频的署名落款，交给作品卡自己排在标题下面。 */
  attribution?: ReactNode
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
      {item.kind === 'video' ? (
        <DynamicVideo item={item} onOpen={onOpen} attribution={attribution} />
      ) : null}
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
  onAuthor,
}: {
  orig: ipc.DynamicItem
  body: DynamicBody
  onOpenVideo: OpenDynamicItem
  onAuthor: OpenDynamicItem
}) {
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

  // 视频引用的署名进作品落款，这里就不再单独占一行，同一个引用里乙只出现一次。
  const inlineAuthor = orig.kind === 'video'

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
      /* 转发只做一层浅底引用，不再套第二道描边：外层是白卡，这里靠底色和缩进分出层级。 */
      className="mt-1 cursor-pointer rounded-[6px] bg-[var(--ga1)] p-3 transition-colors duration-150 hover:bg-[var(--ga2)]"
    >
      {inlineAuthor ? (
        <span className="num mb-1 block text-[11px] text-[var(--text-2)]">{orig.pub_time}</span>
      ) : (
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            data-dynamic-open="original-author"
            onClick={(event) => onAuthor(orig, event)}
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
      )}
      <DynamicContent
        item={orig}
        body={body}
        onOpen={open}
        attribution={
          inlineAuthor ? (
            <button
              type="button"
              data-dynamic-open="original-author"
              onClick={(event) => onAuthor(orig, event)}
              aria-label={`UP ${orig.author}`}
              title={`看 ${orig.author} 的更多视频`}
              data-focus-id={`forward-author:${orig.id}`}
              className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-2)] hover:text-[var(--accent-strong-hover)]"
            >
              <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[14px]">
                UP
              </span>
              <span className="truncate">{orig.author}</span>
            </button>
          ) : undefined
        }
      />
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
  onAuthor: OpenDynamicItem
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
          data-dynamic-open="avatar"
          onClick={(event) => onAuthor(item, event)}
          aria-label={`进入 ${item.author} 的主页`}
          className="t press shrink-0 rounded-full"
        >
          <Avatar src={item.face} alt={item.author} size={48} />
        </button>
        <div className="min-w-0 flex-1 pt-px">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              data-dynamic-open="author"
              onClick={(event) => onAuthor(item, event)}
              className="t line-clamp-2 min-w-0 break-words text-left text-work-name text-[var(--text-1)] hover:text-[var(--accent-strong-hover)]"
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
          <p className="mt-1 text-page-meta text-[var(--text-3)]">
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
                onAuthor={onAuthor}
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
  /** 已加载批数同时留一份 state：筛选态末尾的说明要跟着它更新。 */
  const [pageCount, setPageCount] = useState(0)
  const [following, setFollowing] = useState<Followed[] | null>(null)
  /** 关注列表本身没取到（限流或断网）。和「没关注任何人」要分开说。 */
  const [followingFailed, setFollowingFailed] = useState(false)
  /** 点头像在这一页筛该作者；null 表示全部关注。 */
  const [author, setAuthor] = useState<number | null>(returnPosition?.author ?? null)
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
  const allTop = useRef(dynamicReturn?.allTop ?? 0)
  const filterTop = useRef<number | null>(null)
  const expandedBodies = returnPosition?.expandedBodies ?? []

  const changeFilter = (nextAuthor: number | null, nextTab: DynamicTab): void => {
    if (author === nextAuthor && tab === nextTab) return
    if (author === null && tab === 'all') allTop.current = scrollerRef.current?.scrollTop ?? 0
    filterTop.current = nextAuthor === null && nextTab === 'all' ? allTop.current : 0
    setReturnPosition(undefined)
    setAuthor(nextAuthor)
    setTab(nextTab)
  }

  useLayoutEffect(() => {
    if (filterTop.current === null) return
    scrollerRef.current?.scrollTo({ top: filterTop.current })
    filterTop.current = null
  }, [author, tab])
  const byTab =
    tab === 'all'
      ? items
      : items.filter(
          (item) => item.kind === tab || (tab === 'opus' && item.kind === 'article'),
        )
  const visible = author === null ? byTab : byTab.filter((item) => item.mid === author)
  const pickedName = author === null ? null : (following?.find((u) => u.mid === author)?.name ?? null)

  const load = useCallback(async (next: string | null, append: boolean): Promise<void> => {
    if (pending.current) return
    pending.current = true
    if (!append) prefetchPages.current = 0
    setLoading(true)
    setError(null)
    try {
      const page = await ipc.dynamicFeed(next)
      loadedPages.current = append ? loadedPages.current + 1 : 1
      setPageCount(loadedPages.current)
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

  /**
   * 关注列表：先用关注页已经建好的索引，没有再自己取第一页。
   * 两者都会限流，所以顺序是先白拿缓存、后发请求。
   */
  const loadFollowing = useCallback((): void => {
    const account = useAuthStore.getState().auth?.user?.mid ?? null
    const ready = cachedFollowing(account)
    if (ready) {
      setFollowing(ready)
      setFollowingFailed(false)
      return
    }
    setFollowingFailed(false)
    void ipc
      .following(1)
      .then(([users]) => setFollowing(users))
      .catch(() => {
        setFollowing([])
        setFollowingFailed(true)
      })
  }, [])

  useEffect(() => {
    loadFollowing()
  }, [loadFollowing])

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

  /**
   * 关注头像。窄窗排在标题下横向滚动，宽窗在阅读列右侧竖排常驻：
   * 筛选是这一页的稳定工具，不该随正文一起滚走（#241）。
   */
  const authorButton = (user: Followed, vertical: boolean): ReactNode => (
    <button
      key={user.mid}
      type="button"
      aria-pressed={author === user.mid}
      title={author === user.mid ? `取消只看 ${user.name}` : `只看 ${user.name} 的动态`}
      onClick={() => {
        authorHover.hide()
        changeFilter(author === user.mid ? null : user.mid, tab)
      }}
      onPointerEnter={(event) => authorHover.show(user, event.currentTarget)}
      onPointerLeave={authorHover.hide}
      onFocus={(event) => authorHover.show(user, event.currentTarget)}
      onBlur={authorHover.hide}
      className={`t press shrink-0 rounded-[6px] ${
        vertical ? 'flex w-full items-center gap-2 px-2 py-1 text-left' : 'w-[64px] text-center'
      } ${author === user.mid ? 'text-[var(--accent)]' : ''}`}
    >
      <span
        className={`relative inline-flex rounded-full ${
          author === user.mid ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--panel)]' : ''
        }`}
      >
        <Avatar src={user.face} alt={user.name} size={vertical ? 32 : 48} />
        {user.special ? (
          <span
            title="特别关注"
            className="absolute -right-0.5 -top-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[var(--panel)] text-[#ffb027]"
          >
            <Icon name="star" size={11} />
          </span>
        ) : null}
      </span>
      <span
        className={`block truncate ${
          vertical ? 'min-w-0 flex-1 text-[13px]' : 'mt-1.5 text-[12px] leading-[16px]'
        } ${author === user.mid ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-2)]'}`}
      >
        {user.name}
      </span>
    </button>
  )

  const capturePosition = (event: DynamicOpenEvent, index: number): DynamicReturn | undefined => {
    const scroller = scrollerRef.current
    const target = event.currentTarget
    return scroller
      ? {
          tab,
          author,
          itemIds: visible.map((entry) => entry.id),
          index,
          expandedBodies: Array.from(
            scroller.querySelectorAll<HTMLButtonElement>('button[name="dynamic-body"][aria-expanded="true"]'),
            (button) => button.value,
          ),
          top: target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
          trigger: target.dataset.dynamicOpen ?? 'video',
          allTop: allTop.current,
          restoreFocus: event.type === 'keydown' || event.detail === 0,
          pages: loadedPages.current,
        }
      : undefined
  }

  const openVideo = (item: ipc.DynamicItem, event: DynamicOpenEvent, index: number): void => {
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
    }, capturePosition(event, index))
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
        <div className={`${HEADER} flex h-[56px] items-center`}>
          <h2 className="text-page-title text-[var(--text-1)]">动态</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void ipc
                  .openExternal('https://t.bilibili.com/')
                  .catch((cause) => toastFailure('打开发布页', cause))
              }
              className="t press flex h-8 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-[12.5px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              去 B 站发布
              <Icon name="external" size={12} />
            </button>
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
        <div className={HEADER}>
          <nav aria-label="动态分类" className="flex gap-6">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  changeFilter(author, entry.key)
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
      {followingFailed && !following?.length ? (
        <div className={`${FEED_WIDE} pt-3`}>
          <p className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
            关注列表没取到，暂时不能按作者筛选。
            <button
              type="button"
              onClick={loadFollowing}
              className="t text-[var(--accent)] hover:underline"
            >
              重试
            </button>
          </p>
        </div>
      ) : null}
      {following?.length ? (
        <div className={`${FEED_WIDE} pt-4 xl:hidden`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-[12.5px] text-[var(--text-3)]">
              <span className="shrink-0">关注的人</span>
              {pickedName ? (
                <span data-dynamic-author-filter className="min-w-0 truncate text-[var(--accent)]">
                  只看 {pickedName}
                </span>
              ) : null}
            </h3>
            <div className="flex shrink-0 items-center gap-3">
              {pickedName ? (
                <button
                  type="button"
                  onClick={() => {
                    changeFilter(null, tab)
                  }}
                  className="t text-[12.5px] text-[var(--accent)] hover:underline"
                >
                  显示全部
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => navigate({ kind: 'following' })}
                className="t flex items-center gap-1 text-[12.5px] text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                全部关注
                <Icon name="chevronRight" size={12} />
              </button>
            </div>
          </div>
          <div
            onScroll={authorHover.hide}
            className="no-scrollbar flex gap-3.5 overflow-x-auto rounded-[6px] bg-[var(--panel)] px-4 py-3"
          >
            {following.map((user) => authorButton(user, false))}
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
      <div className={`${FEED} pt-4 xl:grid xl:max-w-[980px] xl:grid-cols-[minmax(0,1fr)_200px] xl:items-start xl:gap-6`}>
        <div className="flex min-w-0 flex-col gap-3">
        {loaded && items.length === 0 ? (
          <EmptyState icon="biliTv" title="关注的人还没有新动态" action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }} />
        ) : null}
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
            onAuthor={(opened, event) => navigate(
              { kind: 'author', name: opened.author, mid: opened.mid },
              capturePosition(event, index),
            )}
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
        {visible.length === 0 && items.length > 0 && !loading && !hasMore && !error && pickedName === null ? (
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
        ) : author !== null && pickedName !== null ? (
          <p className="py-6 text-center text-[12px] text-[var(--text-3)]">
            已加载 {pageCount} 批，找到 {visible.length} 条{pickedName}的更新
            {hasMore ? (
              <button type="button" onClick={() => void load(offset, true)} className="t ml-2 text-[var(--accent)] hover:underline">继续加载</button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                changeFilter(null, tab)
              }}
              className="t ml-2 text-[var(--accent)] hover:underline"
            >
              看全部关注
            </button>
          </p>
        ) : hasMore || items.length === 0 ? null : (
          <p className="py-6 text-center text-[12px] text-[var(--text-3)]">没有更多了</p>
        )}
        </div>
        {following?.length ? (
          <aside
            data-dynamic-author-rail
            role="complementary"
            aria-labelledby="dynamic-author-rail-title"
            className="sticky top-[72px] hidden max-h-[calc(100vh-160px)] flex-col gap-0.5 overflow-y-auto rounded-[6px] bg-[var(--panel)] p-2 xl:flex"
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <h3 id="dynamic-author-rail-title" className="text-[12.5px] text-[var(--text-3)]">
                关注的人
              </h3>
              <button
                type="button"
                onClick={() => navigate({ kind: 'following' })}
                className="t flex shrink-0 items-center text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
                title="查看全部关注"
              >
                全部
                <Icon name="chevronRight" size={11} />
              </button>
            </div>
            {pickedName ? (
              <button
                type="button"
                onClick={() => {
                  changeFilter(null, tab)
                }}
                className="t mx-1 mb-1 rounded-[4px] bg-[var(--accent-soft)] px-2 py-1 text-left text-[11.5px] text-[var(--accent)] hover:underline"
              >
                只看 {pickedName} · 显示全部
              </button>
            ) : null}
            {following.map((user) => authorButton(user, true))}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
