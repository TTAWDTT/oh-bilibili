import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { View } from './appStore'
import { useAppStore } from './appStore'
import { PERSONAL_NAV } from './personalNavigation'
import { Icon } from '../shared/ui/Icon'
import type { IconName } from '../shared/ui/Icon'
import { HOT_CHANNELS } from '../shared/lib/biliChannels'

type Item = { view: View; label: string; icon: IconName }

/**
 * 左侧导航。桌面客户端的主导航竖着放：横着一排频道在宽屏上要跨过整页去点，
 * 而且音乐库、账号这些分组没法表达。分组标题只保留有信息量的两层。
 */
const GROUPS: { title: string | null; items: Item[] }[] = [
  {
    title: null,
    items: [
      { view: { kind: 'home' }, label: '发现', icon: 'biliTv' },
      { view: { kind: 'dynamic' }, label: '动态', icon: 'feedPaperplane' },
      { view: { kind: 'messages' }, label: '消息', icon: 'msgEnvelope' },
      ...HOT_CHANNELS.map((channel) => ({
        view: { kind: channel.view } as View,
        label: channel.label,
        icon: channel.icon,
      })),
      { view: { kind: 'live' }, label: '直播', icon: 'liveCamera' },
      { view: { kind: 'bangumi' }, label: '番剧', icon: 'bangumiClapper' },
    ],
  },
  {
    title: '我的',
    items: [
      PERSONAL_NAV.profile,
      PERSONAL_NAV.history,
      PERSONAL_NAV.favs,
      PERSONAL_NAV.watchLater,
      PERSONAL_NAV.following,
      PERSONAL_NAV.liked,
      PERSONAL_NAV.library,
      PERSONAL_NAV.downloads,
    ],
  },
]

export function Sidebar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)
  const preference = useAppStore((state) => state.sidebar)
  const watchNav = useAppStore((state) => state.watchNav)
  /** 观看页没有自己的导航项，用进入它的那一页（历史栈顶）保留来源高亮。 */
  const previousView = useAppStore((state) => state.history.at(-1)?.view.kind ?? null)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const toggleWatchNav = useAppStore((state) => state.toggleWatchNav)
  const onWatch = view.kind === 'watch'
  const mode = onWatch ? 'watch' : 'browse'
  const [toggledIn, setToggledIn] = useState<typeof mode | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const anchorRows = useRef(new WeakMap<Element, number>())
  const restoreCard = useRef<(() => void) | undefined>(undefined)
  const collapsed = (onWatch ? watchNav : preference) === 'rail'

  // 连点时浏览器会缩短折返动画，正文应在侧栏真正停下的那一帧换宽度。
  useLayoutEffect(() => {
    restoreCard.current?.()
    restoreCard.current = undefined
    if (toggledIn === null) return
    const slide = toggledIn === mode && navRef.current?.getAnimations()
      .find((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'width')
    if (!slide) {
      setToggledIn(null)
      return
    }
    let current = true
    const finish = () => {
      if (!current) return
      restoreCard.current = rememberVisibleCard(anchorRows.current)
      setToggledIn(null)
    }
    void slide.finished.then(finish, finish)
    return () => { current = false }
  }, [collapsed, mode, toggledIn])

  const item = (entry: Item): ReactNode => {
    // 歌单详情还是曲库的一部分，左栏继续停在「曲库」。
    // 观看页保留来源那一项：用户能看出自己是从哪里进来的。
    const source = view.kind === 'watch' ? previousView : view.kind
    const active =
      source === entry.view.kind || (entry.view.kind === 'library' && source === 'playlist')
    return (
      <button
        key={entry.label}
        type="button"
        data-hot-channel={HOT_CHANNELS.some((channel) => channel.view === entry.view.kind) ? entry.view.kind : undefined}
        onClick={() => navigate(entry.view)}
        aria-current={active ? 'page' : undefined}
        aria-label={entry.label}
        title={collapsed ? entry.label : undefined}
        className={[
          'bili-sidebar-row bili-nav-item bili-icon-btn t relative h-9 rounded-lg text-[14px]',
          active
            ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]'
            : 'text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]',
        ].join(' ')}
      >
        <span className="flex h-6 w-6 items-center justify-center justify-self-center [&_img]:size-6">
          <Icon name={entry.icon} size={18} className={active ? 'bili-icon-pop' : ''} />
        </span>
        <span className="bili-sidebar-label">{entry.label}</span>
      </button>
    )
  }

  return (
    <nav
      ref={navRef}
      aria-label="主导航"
      data-collapsed={collapsed}
      data-toggled={toggledIn === mode}
      className={[
        'bili-sidebar h-full shrink-0 flex-col gap-5 overflow-x-hidden overflow-y-auto border-r border-hairline bg-[var(--panel)] px-2 py-4',
        // 观看页在中等宽度先让出这一栏：播放器控制条在 768 加上侧栏会被裁。
        onWatch ? 'hidden lg:flex' : 'hidden md:flex',
      ].join(' ')}
    >
      {GROUPS.map((group, index) => (
        <div key={group.title ?? `g${index}`} className="flex shrink-0 flex-col gap-0.5">
          {group.title && (
            <h2 aria-hidden={collapsed} className="relative mx-2 mb-1 flex h-6 items-center text-[12px] font-semibold text-[var(--text-2)]">
              <span className="absolute inset-x-0 border-t border-hairline" />
              <span className="bili-sidebar-label relative bg-[var(--panel)] pr-2">{group.title}</span>
            </h2>
          )}
          {group.items.map(item)}
        </div>
      ))}
      {/* 设置与收起键钉在底部：收起之后条目变窄但数量不变，靠滚动才能碰到它们就没法展开了。 */}
      <div className="sticky bottom-0 mt-auto flex flex-col gap-0.5 bg-[var(--panel)] pt-1">
        {item(PERSONAL_NAV.settings)}
        <button
          type="button"
          onClick={() => {
            restoreCard.current = rememberVisibleCard(anchorRows.current)
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setToggledIn(mode)
            if (onWatch) toggleWatchNav()
            else toggleSidebar()
          }}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!collapsed}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="bili-sidebar-row t h-9 rounded-[6px] text-[13px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]"
        >
          <span className="bili-sidebar-chevron flex h-6 w-6 items-center justify-center justify-self-center">
            <Icon name="chevronLeft" size={16} />
          </span>
          <span className="bili-sidebar-label">收起</span>
        </button>
      </div>
    </nav>
  )
}

/** 换列时用首个可见投稿保持阅读位置。网格按行排列，只需比较几张卡的高度。 */
function rememberVisibleCard(anchorRows: WeakMap<Element, number>): (() => void) | undefined {
  const scroller = document.getElementById('scroll-main')
  if (!scroller?.scrollTop) return
  const top = scroller.getBoundingClientRect().top
  for (const grid of scroller.querySelectorAll('[data-shown]')) {
    const bounds = grid.getBoundingClientRect()
    if (bounds.top > top || bounds.bottom <= top) continue
    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1) {
      return () => { scroller.scrollTop = scroller.scrollHeight }
    }
    const cards = grid.getElementsByTagName('article')
    let start = 0
    let end = cards.length
    while (start < end) {
      const middle = Math.floor((start + end) / 2)
      if (cards[middle]!.getBoundingClientRect().bottom <= top) start = middle + 1
      else end = middle
    }
    const first = cards[start]
    if (!first) continue
    const before = first.getBoundingClientRect().top
    // 三列变四列后，原来第一张的左边可能多出投稿；折返时仍以原来那张为准。
    const previous = anchorRows.get(grid)
    const index = previous !== undefined && cards[previous]?.getBoundingClientRect().top === before
      ? previous : start
    anchorRows.set(grid, index)
    const card = cards[index]!
    return () => {
      scroller.scrollTop += Math.round(card.getBoundingClientRect().top) - Math.round(before)
    }
  }
}
