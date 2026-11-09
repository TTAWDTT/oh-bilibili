import type { RailTab } from '../../app/appStore'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { ReactionButtons } from '../../shared/ui/ReactionButtons'
import { LyricsView } from './LyricsView'
import { usePlayerStore } from './playerStore'
import { QueueList } from './QueueList'

function RailTabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        't flex h-8 items-center border-b-2 text-[14px]',
        active
          ? 'border-[var(--accent)] font-medium text-[var(--accent)]'
          : 'border-transparent text-[var(--text-2)] hover:text-[var(--text-1)]',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function TrackHeader({ track, quality, loading }: { track: Track; quality: number | null; loading: boolean }) {
  return (
    <div className="flex gap-4 px-5 py-4">
      <div className="shrink-0">
        <Cover
          cover={track.cover}
          title={track.title}
          className="h-[84px] w-[84px] rounded-[4px] border border-[var(--line)]"
          glyphClassName="text-[30px] font-semibold text-[var(--text-2)]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px] tracking-[0.16em] text-[var(--text-2)]">
          正在播放
          {loading ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft" /> : null}
        </div>
        <div
          className="mt-2 truncate font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-1)]"
          title={track.title}
        >
          {track.title}
        </div>
        <div className="mt-1 truncate text-[14px] text-[var(--text-2)]" title={track.artist}>
          {track.artist}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ReactionButtons track={track} size={15} />
          <span className="num rounded-[3px] border border-[var(--line)] px-2 py-0 font-mono text-[12px] text-[var(--text-2)]">
            {quality ? `${quality}K` : '——'}
          </span>
        </div>
      </div>
    </div>
  )
}

export function NowPlayingRail({ tab }: { tab: RailTab }) {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const queue = usePlayerStore((state) => state.queue)
  const navigate = useAppStore((state) => state.navigate)
  const toggleRail = useAppStore((state) => state.toggleRail)
  const closeRail = useAppStore((state) => state.closeRail)
  const track = snapshot?.track ?? null
  const queued = queue?.items.length ?? 0

  return (
    <aside aria-label="播放右栏" className="flex h-full w-[var(--rail-w)] flex-col overflow-hidden border-l border-hairline bg-[var(--panel)]">
      <span className="bili-topline h-[2px] w-full opacity-70" />
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline pl-5 pr-3">
        <div className="flex h-full items-center gap-4">
          <RailTabButton active={tab === 'lyrics'} label="歌词" onClick={() => toggleRail('lyrics')} />
          <RailTabButton
            active={tab === 'queue'}
            label={queued > 0 ? `队列 ${queued}` : '队列'}
            onClick={() => toggleRail('queue')}
          />
        </div>
        <button
          type="button"
          aria-label="收起右栏"
          title="收起右栏（Esc）"
          onClick={closeRail}
          className="t press flex items-center justify-center rounded-[4px] h-6 w-6 text-[var(--text-2)] hover:text-[var(--text-1)]"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {track ? <TrackHeader track={track} quality={snapshot?.quality_kbps ?? null} loading={snapshot?.phase === 'loading'} /> : null}

      <div className="flex min-h-0 flex-1 flex-col border-t border-hairline">
        {tab === 'queue' ? (
          <QueueList />
        ) : track ? (
          <LyricsView track={track} />
        ) : (
          <EmptyState
            icon="biliTv"
            title="还没有在播放"
            detail="挑一首歌，歌词会跟着进度滚动。"
            action={{ label: '去搜索', onClick: () => navigate({ kind: 'search' }) }}
            compact
          />
        )}
      </div>
    </aside>
  )
}
