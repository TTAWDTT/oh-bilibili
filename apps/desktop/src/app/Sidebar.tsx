import type { ReactNode } from 'react'
import type { View } from './appStore'
import { useAppStore } from './appStore'
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
      { view: { kind: 'dynamic' }, label: '动态', icon: 'dynamic' },
      { view: { kind: 'messages' }, label: '消息', icon: 'message' },
      ...HOT_CHANNELS.map((channel) => ({
        view: { kind: channel.view } as View,
        label: channel.label,
        icon: channel.icon,
      })),
      { view: { kind: 'live' }, label: '直播', icon: 'live' },
      { view: { kind: 'bangumi' }, label: '番剧', icon: 'bangumi' },
    ],
  },
  {
    title: '我的',
    items: [
      { view: { kind: 'profile' }, label: '个人中心', icon: 'user' },
      { view: { kind: 'history' }, label: '历史', icon: 'clock' },
      { view: { kind: 'favs' }, label: '收藏夹', icon: 'bookmarkStar' },
      { view: { kind: 'watchLater' }, label: '稍后再看', icon: 'watchLater' },
      { view: { kind: 'following' }, label: '关注', icon: 'user' },
      { view: { kind: 'liked' }, label: '赞过的视频', icon: 'heartFilled' },
      // 曲库与下载是「我的」里的两项，不是并列于整站的第二个产品：
      // 单开一个「音乐」分组会让每个页面都先看到听歌入口。
      { view: { kind: 'library' }, label: '曲库', icon: 'library' },
      { view: { kind: 'downloads' }, label: '已下载', icon: 'download' },
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
  const collapsed = (onWatch ? watchNav : preference) === 'rail'

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
        aria-label={collapsed ? entry.label : undefined}
        title={collapsed ? entry.label : undefined}
        className={[
          'bili-icon-btn t flex h-9 items-center gap-2.5 rounded-[6px] text-[14px]',
          collapsed ? 'justify-center px-0' : 'px-2.5',
          active
            ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
            : 'text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]',
        ].join(' ')}
      >
        <Icon name={entry.icon} size={16} className={active ? 'bili-icon-pop' : ''} />
        {collapsed ? null : <span className="bili-sidebar-label min-w-0 truncate">{entry.label}</span>}
      </button>
    )
  }

  return (
    <nav
      aria-label="主导航"
      className={[
        'bili-sidebar h-full shrink-0 flex-col gap-5 overflow-y-auto border-r border-hairline bg-[var(--panel)] py-4',
        // 观看页在中等宽度先让出这一栏：播放器控制条在 768 加上侧栏会被裁。
        onWatch ? 'hidden lg:flex' : 'hidden md:flex',
        collapsed ? 'w-[60px] px-2' : 'w-[208px] px-3',
      ].join(' ')}
    >
      {GROUPS.map((group, index) => (
        <div key={group.title ?? `g${index}`} className="flex flex-col gap-0.5">
          {group.title && !collapsed ? (
            <h2 className="px-2.5 pb-1 text-[12px] font-normal text-[var(--text-3)]">{group.title}</h2>
          ) : null}
          {group.title && collapsed && index > 0 ? (
            <span className="mx-1 mb-1 border-t border-hairline" />
          ) : null}
          {group.items.map(item)}
        </div>
      ))}
      {/* 设置与收起键钉在底部：收起之后条目变窄但数量不变，靠滚动才能碰到它们就没法展开了。 */}
      <div className="sticky bottom-0 mt-auto flex flex-col gap-0.5 bg-[var(--panel)] pt-1">
        {item({ view: { kind: 'settings' }, label: '设置', icon: 'settings' })}
        <button
          type="button"
        onClick={onWatch ? toggleWatchNav : toggleSidebar}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!collapsed}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className={`bili-icon-btn t press flex h-9 items-center gap-2.5 rounded-[6px] text-[13px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)] ${
            collapsed ? 'justify-center px-0' : 'px-2.5'
          }`}
        >
          <Icon name="chevronLeft" size={15} className={collapsed ? 'rotate-180' : ''} />
          {collapsed ? null : <span className="bili-sidebar-label">收起</span>}
        </button>
      </div>
    </nav>
  )
}
