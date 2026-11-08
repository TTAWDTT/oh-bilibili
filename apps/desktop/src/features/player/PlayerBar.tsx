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
        't press relative flex h-8 items-center gap-1 rounded-full px-2',
        enabled
          ? active
            ? 'text-[var(--accent)]'
            : 'text-white/42 hover:bg-white/8 hover:text-white/84'
          : 'cursor-default text-white/18',
      ].join(' ')}
    >
      <Icon name={tab === 'lyrics' ? 'lyrics' : 'queue'} size={16} />
      {tab === 'queue' && count > 0 ? <span className="num text-[10.5px]">{count}</span> : null}
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
        className="t press flex items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-white/[0.04]"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/14 text-white/28">
          <Icon name="music" size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-white/72">还没有在播放</span>
          <span className="mt-1 block text-[11.5px] text-white/38">去搜索里挑一首 →</span>
        </span>
      </button>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative shrink-0">
        <div className="absolute -inset-1 rounded-xl opacity-70 blur-lg" style={{ background: 'var(--accent-soft)' }} />
        <Cover
          cover={track.cover}
          title={track.title}
          className="relative h-14 w-14 rounded-xl border border-white/12"
          glyphClassName="text-[22px] font-semibold text-white/60"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium leading-tight text-white" title={track.title}>
          {track.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="truncate text-[11.5px] text-white/44" title={track.artist}>
            {track.artist}
          </span>
          <span className="num shrink-0 rounded-full border border-white/12 px-1.5 py-[1px] font-mono text-[9px] text-white/40">
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
    <div className="relative z-20 px-3 pb-3">
      {/* 三等分列宽让控制区真正落在窗口中线，两侧对称才不会显得偏 */}
      <section className="glass grid h-[92px] grid-cols-[minmax(0,1fr)_minmax(340px,1.7fr)_minmax(0,1fr)] items-center gap-6 rounded-[24px] border border-hairline px-5 shadow-[0_24px_70px_-34px_rgba(0,0,0,0.95)]">
        <TrackInfo track={track} quality={snapshot?.quality_kbps ?? null} />

        <div className="flex min-w-0 flex-col items-center gap-2">
          <Transport />
          <PlaybackProgress />
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          {track ? <ReactionButtons track={track} size={15} className="hidden 2xl:flex" /> : null}
          <VolumeControl />
          <span className="h-5 w-px bg-white/10" />
          <RailToggle tab="lyrics" active={rail === 'lyrics'} enabled={track !== null} />
          <RailToggle tab="queue" active={rail === 'queue'} count={queued} enabled={queued > 0} />
        </div>
      </section>
    </div>
  )
}
