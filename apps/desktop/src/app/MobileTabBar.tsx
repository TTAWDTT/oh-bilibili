import type { View } from './appStore'
import { useAppStore } from './appStore'
import { PERSONAL_NAV } from './personalNavigation'
import { Icon } from '../shared/ui/Icon'
import type { IconName } from '../shared/ui/Icon'

/**
 * 移动端底部标签栏。
 *
 * 桌面端靠左侧栏切换视图；窄屏放不下，收成底部标签栏，
 * 和 B 站 App 的「首页 / 动态 / 我的」是同一个信息层次。
 */
const TABS: readonly { view: View; label: string; icon: IconName }[] = [
  { view: { kind: 'home' }, label: '发现', icon: 'biliTv' },
  { view: { kind: 'dynamic' }, label: '动态', icon: 'feedPaperplane' },
  PERSONAL_NAV.library,
  { ...PERSONAL_NAV.liked, label: '赞过' },
  { ...PERSONAL_NAV.profile, label: '我的' },
]

export function MobileTabBar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)

  return (
    <nav
      aria-label="主要导航"
      className="safe-bottom flex shrink-0 items-stretch border-t border-[var(--line)] bg-[var(--panel)] md:hidden"
    >
      {TABS.map((tab) => {
        const active =
          view.kind === tab.view.kind || (tab.view.kind === 'library' && view.kind === 'playlist')
        return (
          <button
            key={tab.view.kind}
            type="button"
            onClick={() => navigate(tab.view)}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px]',
              active ? 'font-semibold text-[var(--accent-strong)]' : 'text-[var(--text-3)]',
            ].join(' ')}
          >
            <span className={`flex h-6 w-10 items-center justify-center rounded-full [&_img]:size-6 ${active ? 'bg-[var(--accent-soft)]' : ''}`}>
              <Icon name={tab.icon} size={19} />
            </span>
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
