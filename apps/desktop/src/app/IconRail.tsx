import type { View } from './appStore'
import { useAppStore } from './appStore'
import { useDownloadsStore } from '../features/downloads/downloadsStore'
import { useLibraryStore } from '../features/library/libraryStore'
import { useReactionStore } from '../features/reactions/reactionStore'
import { Icon } from '../shared/ui/Icon'
import type { IconName } from '../shared/ui/Icon'

type NavItem = { view: View; label: string; icon: IconName }

const NAV: readonly NavItem[] = [
  { view: { kind: 'search' }, label: '搜索', icon: 'search' },
  { view: { kind: 'library' }, label: '曲库', icon: 'library' },
  { view: { kind: 'liked' }, label: '喜欢', icon: 'heart' },
  { view: { kind: 'downloads' }, label: '下载', icon: 'download' },
  { view: { kind: 'settings' }, label: '设置', icon: 'settings' },
]

/**
 * 图标条。编辑器式外壳的第一段：只放图标，不带文字。
 * 激活态用左侧 2px 色条加图标提亮，和侧栏的选中行是两套语义（这里是「切模块」，那里是「选中条目」）。
 */
export function IconRail() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)
  const liked = useReactionStore((state) => state.likedTracks.length)
  const downloads = useDownloadsStore((state) => state.items)

  return (
    <nav aria-label="主导航" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-hairline bg-[var(--panel-alt)] py-2">
      {NAV.map((item) => {
        const active = view.kind === item.view.kind
        const running = (downloads ?? []).filter(
          (d) => d.state === 'running' || d.state === 'queued',
        ).length
        const badge = item.view.kind === 'liked' ? liked : item.view.kind === 'downloads' ? running : 0
        return (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.view)}
            aria-label={item.label}
            title={item.label}
            aria-current={active ? 'page' : undefined}
            className={[
              't relative flex h-9 w-9 items-center justify-center rounded-[4px]',
              active
                ? 'bg-[var(--hover)] text-[var(--text-1)]'
                : 'text-[var(--text-2)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]',
            ].join(' ')}
          >
            {active ? (
              <span className="absolute -left-1 top-1.5 h-6 w-[2px] rounded-full bg-[var(--accent)]" />
            ) : null}
            <Icon name={item.icon} size={17} />
            {badge > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-[var(--accent)] px-1 text-center text-[9px] leading-[14px] text-black">
                {badge > 99 ? '99' : badge}
              </span>
            ) : null}
          </button>
        )
      })}
      <div className="mt-auto">
        <PlaylistShortcut />
      </div>
    </nav>
  )
}

function PlaylistShortcut() {
  const playlists = useLibraryStore((state) => state.playlists)
  return (
    <span
      className="num flex h-6 w-9 items-center justify-center text-[10px] text-[var(--text-3)]"
      title={`${playlists?.length ?? 0} 个歌单`}
    >
      {playlists?.length ?? 0}
    </span>
  )
}
