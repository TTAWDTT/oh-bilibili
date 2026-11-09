import type { View } from './appStore'
import { useAppStore } from './appStore'
import { usePlayerStore } from '../features/player/playerStore'
import { Icon } from '../shared/ui/Icon'
import type { IconName } from '../shared/ui/Icon'

/**
 * 移动端底部标签栏。
 *
 * 桌面端靠左侧栏 + 频道栏切换视图；窄屏放不下两条，收成底部四个标签，
 * 和 B 站 App 的「首页 / 频道 / 动态 / 我的」是同一个信息层次。
 */
const TABS: readonly { kind: View['kind']; label: string; icon: IconName }[] = [
  { kind: 'search', label: '发现', icon: 'search' },
  { kind: 'library', label: '曲库', icon: 'library' },
  { kind: 'liked', label: '喜欢', icon: 'heart' },
  { kind: 'settings', label: '我的', icon: 'user' },
]

export function MobileTabBar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)
  const track = usePlayerStore((state) => state.snapshot?.track ?? null)

  return (
    <nav
      aria-label="主要导航"
      className="safe-bottom flex shrink-0 items-stretch border-t border-[var(--line)] bg-[var(--panel)] md:hidden"
    >
      {TABS.map((tab) => {
        const active = view.kind === tab.kind
        // 「喜欢」在没有歌可喜欢时依然是可点的，只是不高亮
        void track
        return (
          <button
            key={tab.kind}
            type="button"
            onClick={() => navigate({ kind: tab.kind } as View)}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
              active ? 'text-[var(--accent)]' : 'text-[var(--text-3)]',
            ].join(' ')}
          >
            <Icon name={tab.icon} size={19} />
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
