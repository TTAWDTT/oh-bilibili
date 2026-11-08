import { WaveRibbon } from './WaveRibbon'
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
            : 'text-[var(--text-2)] hover:text-white'
          : 'cursor-default text-[var(--text-2)]',
      ].join(' ')}
    >
      <Icon name={tab === 'lyrics' ? 'lyrics' : 'queue'} size={16} />
      {tab === 'queue' && count > 0 ? <span className="num text-[11px]">{count}</span> : null}
    </button>
  )
}

function TrackInfo({ track, quality }: { track: Track | null; quality: number | null }) {
  const setStage = useAppStore((state) => state.setStage)
  const playing = usePlayerStore((state) => state.snapshot?.phase === 'playing')

  if (!track) {
    return (
      <button
        type="button"
        onClick={() => setStage(true)}
        className="t group flex h-10 items-center gap-2 px-1 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-hairline text-[var(--text-2)]">
          <Icon name="music" size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-[var(--text-2)] group-hover:text-[var(--text-1)]">还没有在播放</span>
          <span className="mt-1 block text-[12px] text-[var(--text-2)] group-hover:text-[var(--text-2)]">去搜索里挑一首 →</span>
        </span>
      </button>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => setStage(true)}
        aria-label="打开播放舞台"
        className="bili-press relative shrink-0 overflow-hidden rounded-[4px] border border-[var(--line)]"
      >
        <Cover
          cover={track.cover}
          title={track.title}
          className="h-10 w-10"
          glyphClassName="text-[20px] font-semibold text-[var(--text-2)]"
        />
        {playing ? (
          <span className="bili-playing-bars absolute bottom-0 left-0 right-0 flex items-end justify-center gap-[2px] bg-black/35 pb-[3px] pt-[6px]">
            <i /><i /><i />
          </span>
        ) : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="bili-marquee truncate text-[13px] font-medium leading-tight text-[var(--text-1)]" title={track.title}>
          {track.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="truncate text-[12px] text-[var(--text-2)]" title={track.artist}>
            {track.artist}
          </span>
          <span className="num shrink-0 rounded-[3px] border border-[var(--line)] px-2 py-0 font-mono text-[10px] text-[var(--text-2)]">
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 opacity-45">
        <WaveRibbon />
      </div>
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
