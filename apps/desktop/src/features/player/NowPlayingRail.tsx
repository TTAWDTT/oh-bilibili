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
        't press rounded-full px-3 py-1 text-[11.5px]',
        active ? 'bg-white/14 text-white' : 'text-white/44 hover:bg-white/[0.06] hover:text-white/80',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function TrackHeader({ track, quality, loading }: { track: Track; quality: number | null; loading: boolean }) {
  return (
    <div className="flex gap-4 px-5 pt-4">
      <div className="relative shrink-0">
        <div className="absolute -inset-3 rounded-2xl opacity-60 blur-2xl" style={{ background: 'var(--accent-soft)' }} />
        <Cover
          cover={track.cover}
          title={track.title}
          className="relative h-[84px] w-[84px] rounded-xl border border-white/12"
          glyphClassName="text-[30px] font-semibold text-white/60"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-white/32">
          正在播放
          {loading ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft" /> : null}
        </div>
        <div
          className="mt-2 truncate font-display text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] text-white"
          title={track.title}
        >
          {track.title}
        </div>
        <div className="mt-1 truncate text-[12px] text-white/44" title={track.artist}>
          {track.artist}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ReactionButtons track={track} size={15} />
          <span className="num rounded-full border border-white/12 px-2 py-[1px] font-mono text-[9px] text-white/40">
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
    <aside
      aria-label="播放右栏"
      className="glass flex h-full w-[336px] flex-col overflow-hidden rounded-[26px] border border-hairline"
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <div className="flex items-center gap-1">
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
          className="t press rounded-full p-1.5 text-white/34 hover:bg-white/8 hover:text-white/80"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {track ? <TrackHeader track={track} quality={snapshot?.quality_kbps ?? null} loading={snapshot?.phase === 'loading'} /> : null}

      <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-hairline">
        {tab === 'queue' ? (
          <QueueList />
        ) : track ? (
          <LyricsView track={track} />
        ) : (
          <EmptyState
            icon="music"
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
