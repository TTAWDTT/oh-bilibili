import type { View } from './appStore'
import { useAppStore } from './appStore'
import { Icon } from '../shared/ui/Icon'
import type { IconName } from '../shared/ui/Icon'

type Channel = { view: View; label: string; icon: IconName }

/** B 站网页端那条白色频道栏。当前频道用粉色下划线标记，和侧栏的选中行是两套语义。 */
const CHANNELS: readonly Channel[] = [
  { view: { kind: 'search' }, label: '搜索', icon: 'search' },
  { view: { kind: 'library' }, label: '曲库', icon: 'library' },
  { view: { kind: 'liked' }, label: '喜欢', icon: 'heart' },
  { view: { kind: 'downloads' }, label: '下载', icon: 'download' },
  { view: { kind: 'settings' }, label: '设置', icon: 'settings' },
]

export function ChannelBar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)

  return (
    <nav
      aria-label="频道"
      className="flex h-12 shrink-0 items-stretch gap-1 border-b border-[var(--line)] bg-[var(--panel)] pl-[80px] pr-4"
    >
      {CHANNELS.map((channel) => {
        const active = view.kind === channel.view.kind
        return (
          <button
            key={channel.label}
            type="button"
            onClick={() => navigate(channel.view)}
            aria-current={active ? 'page' : undefined}
            className={[
              't relative flex items-center gap-1.5 px-3 text-[13px]',
              active
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]',
            ].join(' ')}
          >
            <Icon name={channel.icon} size={14} />
            {channel.label}
            {active ? (
              <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
