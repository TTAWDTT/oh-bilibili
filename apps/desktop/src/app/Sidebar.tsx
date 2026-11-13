import type { ReactNode } from 'react'
import type { View } from './appStore'
import { useAppStore } from './appStore'
import { Icon } from '../shared/ui/Icon'
import type { IconName } from '../shared/ui/Icon'

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
      { view: { kind: 'ranking' }, label: '排行', icon: 'rank' },
      { view: { kind: 'popular' }, label: '热门', icon: 'flame' },
      { view: { kind: 'precious' }, label: '入站必刷', icon: 'gift' },
      { view: { kind: 'weekly' }, label: '每周必看', icon: 'calendar' },
      { view: { kind: 'search' }, label: '搜索', icon: 'search' },
    ],
  },
  {
    title: '我的',
    items: [
      { view: { kind: 'history' }, label: '历史', icon: 'clock' },
      { view: { kind: 'favs' }, label: '收藏夹', icon: 'bookmarkStar' },
      { view: { kind: 'watchLater' }, label: '稍后再看', icon: 'watchLater' },
      { view: { kind: 'following' }, label: '关注', icon: 'user' },
    ],
  },
  {
    title: '音乐',
    items: [
      { view: { kind: 'library' }, label: '曲库', icon: 'library' },
      { view: { kind: 'liked' }, label: '喜欢', icon: 'heartFilled' },
      { view: { kind: 'downloads' }, label: '已下载', icon: 'download' },
    ],
  },
]

export function Sidebar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)

  const item = (entry: Item): ReactNode => {
    const active = view.kind === entry.view.kind
    return (
      <button
        key={entry.label}
        type="button"
        onClick={() => navigate(entry.view)}
        aria-current={active ? 'page' : undefined}
        className={[
          't flex h-9 items-center gap-2.5 rounded-[6px] px-2.5 text-[14px]',
          active
            ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
            : 'text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]',
        ].join(' ')}
      >
        <Icon name={entry.icon} size={16} />
        {entry.label}
      </button>
    )
  }

  return (
    <nav
      aria-label="主导航"
      className="hidden h-full w-[208px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-hairline bg-[var(--panel)] px-3 py-4 md:flex"
    >
      {GROUPS.map((group, index) => (
        <div key={group.title ?? `g${index}`} className="flex flex-col gap-0.5">
          {group.title ? (
            <h2 className="px-2.5 pb-1 text-[12px] font-normal text-[var(--text-3)]">{group.title}</h2>
          ) : null}
          {group.items.map(item)}
        </div>
      ))}
      <div className="mt-auto flex flex-col gap-0.5">
        {item({ view: { kind: 'settings' }, label: '设置', icon: 'settings' })}
      </div>
    </nav>
  )
}
