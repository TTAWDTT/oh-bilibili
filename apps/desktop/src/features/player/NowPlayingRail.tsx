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
        't flex h-8 items-center border-b-2 text-[12px]',
        active ? 'border-[var(--accent)] text-white' : 'border-transparent text-white/62 hover:text-white',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function TrackHeader({ track, quality, loading }: { track: Track; quality: number | null; loading: boolean }) {
  // 播放中才转：暂停时静止，避免满屏都在动。
  const playing = usePlayerStore((state) => state.snapshot?.phase === 'playing')
  return (
    <div className="flex gap-4 px-5 py-4">
      <div className="stage-cover shrink-0" data-playing={playing}>
        <Cover
          cover={track.cover}
          title={track.title}
          className="h-[84px] w-[84px] rounded-[4px] border border-white/32"
          glyphClassName="text-[30px] font-semibold text-white/70"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-white/48">
          正在播放
          {loading ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft" /> : null}
        </div>
        <div
          className="mt-2 truncate font-display text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] text-white"
          title={track.title}
        >
          {track.title}
        </div>
        <div className="mt-1 truncate text-[12px] text-white/62" title={track.artist}>
          {track.artist}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ReactionButtons track={track} size={15} />
          <span className="num rounded-[3px] border border-white/32 px-2 py-0 font-mono text-[10px] text-white/62">
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
          className="t press flex items-center justify-center rounded-[4px] h-6 w-6 text-white/48 hover:text-white"
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
