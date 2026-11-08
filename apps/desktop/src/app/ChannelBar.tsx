import type { View } from './appStore'
import { useAppStore } from './appStore'
import { useDanmakuSettings } from '../features/player/danmakuSettings'
import { PartitionIcon } from '../shared/ui/PartitionIcon'

type ChannelKind = 'search' | 'music' | 'anime' | 'film' | 'history' | 'favs' | 'settings'
type Channel = { view: View; label: string; kind: ChannelKind }

/** B 站网页端那条白色频道栏。当前频道用粉色下划线标记，和侧栏的选中行是两套语义。 */
const CHANNELS: readonly Channel[] = [
  { view: { kind: 'search' }, label: '搜索', kind: 'search' },
  { view: { kind: 'library' }, label: '曲库', kind: 'music' },
  { view: { kind: 'liked' }, label: '喜欢', kind: 'anime' },
  { view: { kind: 'downloads' }, label: '下载', kind: 'film' },
  { view: { kind: 'history' }, label: '历史', kind: 'history' },
  { view: { kind: 'favs' }, label: '收藏夹', kind: 'favs' },
  { view: { kind: 'settings' }, label: '设置', kind: 'settings' },
]

export function ChannelBar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)

  return (
    <nav
      aria-label="频道"
      className="relative flex h-12 shrink-0 items-stretch gap-1 border-b border-[var(--line)] bg-[var(--panel)] pl-[80px] pr-4"
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
            <PartitionIcon kind={channel.kind} size={18} />
            {channel.label}
            {active ? (
              <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />
            ) : null}
          </button>
        )
      })}
      <span className="bili-topline absolute inset-x-0 bottom-0 h-[2px] opacity-70" />
      <div className="ml-auto flex items-center gap-2 pr-1">
        <DanmakuToggle />
      </div>
      <span className="bili-topline absolute inset-x-0 bottom-0 h-[2px] opacity-70" />
    </nav>
  )
}

/** 弹幕总开关。B 站播放器上就是这样一个「弹」字按钮，一眼能认出来。 */
function DanmakuToggle() {
  const enabled = useDanmakuSettings((s) => s.enabled)
  const setEnabled = useDanmakuSettings((s) => s.setEnabled)
  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      aria-pressed={enabled}
      title={enabled ? '关闭弹幕' : '打开弹幕'}
      className={[
        'bili-press flex h-6 items-center gap-1 rounded-[3px] border px-2 text-[11.5px] transition-colors',
        enabled
          ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--bili-pink)_10%,white)] text-[var(--accent)]'
          : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-2)]',
      ].join(' ')}
    >
      弹
    </button>
  )
}
