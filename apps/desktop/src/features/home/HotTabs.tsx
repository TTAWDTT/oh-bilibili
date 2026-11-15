import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'

export type HotTab = 'popular' | 'weekly' | 'precious' | 'ranking'

const TABS: { view: HotTab; label: string }[] = [
  { view: 'popular', label: '综合热门' },
  { view: 'weekly', label: '每周必看' },
  { view: 'precious', label: '入站必刷' },
  { view: 'ranking', label: '排行榜' },
]

/**
 * B 站热门页共用的白色 header 带：大标题、一行页面说明、四个原生文字 tab。
 * 四页原本各写一套标题，从侧栏进来时看不出它们是同一组榜单。
 */
export function HotTabs({
  active,
  title,
  extra,
  aside,
  children,
  below,
}: {
  active: HotTab
  title: string
  extra?: string | undefined
  aside?: ReactNode
  /** 标题下面的页面说明或期数选择器。 */
  children?: ReactNode
  /** tab 条下面再一层子 tab（排行榜的分区）。 */
  below?: ReactNode
}) {
  const navigate = useAppStore((state) => state.navigate)

  return (
    <nav className="mb-4 bg-[var(--panel)] px-4 pt-4 md:px-8">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[20px] font-medium leading-[28px] text-[var(--text-1)]">{title}</h2>
        {extra ? <span className="num text-[12px] text-[var(--text-3)]">{extra}</span> : null}
        {aside ? <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div> : null}
      </div>
      {children ? <div className="mt-1">{children}</div> : null}
      <div className="no-scrollbar -mb-px mt-3 flex items-center gap-6 overflow-x-auto border-b border-[var(--line)]">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            aria-current={tab.view === active ? 'page' : undefined}
            onClick={() => {
              if (tab.view !== active) navigate({ kind: tab.view })
            }}
            className={`t shrink-0 whitespace-nowrap border-b-2 pb-2 text-[14px] ${
              tab.view === active
                ? 'border-[var(--accent)] font-medium text-[var(--accent)]'
                : 'border-transparent text-[var(--text-2)] hover:text-[var(--accent)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {below}
    </nav>
  )
}
