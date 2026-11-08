import { LevelBars } from './LevelBars'
import { useAppStore } from '../../app/appStore'
import type { RailTab } from '../../app/appStore'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { ReactionButtons } from '../../shared/ui/ReactionButtons'
import type { Track } from '../../shared/lib/contract'
import { PlaybackProgress } from './PlaybackProgress'
import { usePlayerStore } from './playerStore'
import { Transport } from './Transport'
import { VolumeControl } from './VolumeControl'

function RailToggle({
  tab,
  active,
  count = 0,
  enabled,
}: {
  tab: RailTab
  active: boolean
  count?: number
  enabled: boolean
}) {
  const toggleRail = useAppStore((state) => state.toggleRail)
  const label = tab === 'lyrics' ? '歌词栏' : '播放队列'
  return (
    <button
      type="button"
      aria-label={label}
      title={enabled ? label : '播放一首歌后可查看'}
      aria-pressed={active}
      disabled={!enabled}
      onClick={() => toggleRail(tab)}
      className={[
        't press relative flex h-8 items-center gap-1 rounded-[4px] px-2',
        enabled
          ? active
            ? 'text-[var(--accent)]'
            : 'text-white/62 hover:text-white'
          : 'cursor-default text-white/48',
      ].join(' ')}
    >
      <Icon name={tab === 'lyrics' ? 'lyrics' : 'queue'} size={16} />
      {tab === 'queue' && count > 0 ? <span className="num text-[11px]">{count}</span> : null}
    </button>
  )
}

function TrackInfo({ track, quality }: { track: Track | null; quality: number | null }) {
  const navigate = useAppStore((state) => state.navigate)

  if (!track) {
    return (
      <button
        type="button"
        onClick={() => navigate({ kind: 'search' })}
        className="t group flex h-10 items-center gap-2 px-1 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-hairline text-white/48">
          <Icon name="music" size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-white/70 group-hover:text-white">还没有在播放</span>
          <span className="mt-1 block text-[12px] text-white/48 group-hover:text-white/70">去搜索里挑一首 →</span>
        </span>
      </button>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Cover
        cover={track.cover}
        title={track.title}
        className="h-10 w-10 shrink-0 rounded-[4px] border border-white/32"
        glyphClassName="text-[20px] font-semibold text-white/70"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight text-white" title={track.title}>
          {track.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="truncate text-[12px] text-white/62" title={track.artist}>
            {track.artist}
          </span>
          <span className="num shrink-0 rounded-[3px] border border-white/32 px-2 py-0 font-mono text-[10px] text-white/62">
            {quality ? `${quality}K` : '——'}
          </span>
        </div>
      </div>
    </div>
  )
}

export function PlayerBar() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const rail = useAppStore((state) => state.rail)
  const queued = usePlayerStore((state) => state.queue?.items.length ?? 0)
  const track = snapshot?.track ?? null

  return (
    // 三等分列宽让控制区真正落在窗口中线，两侧对称才不会显得偏。
    <section className="relative z-20 grid h-14 shrink-0 overflow-hidden grid-cols-[minmax(0,1fr)_minmax(340px,1.7fr)_minmax(0,1fr)] items-center gap-6 border-t border-hairline bg-[var(--panel)] px-3">
      <TrackInfo track={track} quality={snapshot?.quality_kbps ?? null} />

      <div className="flex min-w-0 flex-col items-center gap-0">
        <Transport />
        <PlaybackProgress />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        {track ? <ReactionButtons track={track} size={15} className="hidden 2xl:flex" /> : null}
        <LevelBars />
        <VolumeControl />
        <span className="h-5 w-px bg-white/32" />
        <RailToggle tab="lyrics" active={rail === 'lyrics'} enabled={track !== null} />
        <RailToggle tab="queue" active={rail === 'queue'} count={queued} enabled={queued > 0} />
      </div>
    </section>
  )
}
