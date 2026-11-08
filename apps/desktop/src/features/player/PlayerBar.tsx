import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import type { RailTab } from '../../app/appStore'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { ReactionButtons } from '../../shared/ui/ReactionButtons'
import { PlaybackProgress } from './PlaybackProgress'
import { usePlayerStore } from './playerStore'
import { Transport } from './Transport'
import { VolumeControl } from './VolumeControl'

function RailToggle({ tab, active, children }: { tab: RailTab; active: boolean; children: ReactNode }) {
  const toggleRail = useAppStore((state) => state.toggleRail)
  return (
    <button
      type="button"
      aria-label={tab === 'lyrics' ? '歌词栏' : '播放队列'}
      title={tab === 'lyrics' ? '歌词栏' : '播放队列'}
      aria-pressed={active}
      onClick={() => toggleRail(tab)}
      className={[
        'rounded-full p-1.5 transition duration-200',
        active ? 'text-[var(--accent)]' : 'text-white/38 hover:bg-white/8 hover:text-white/80',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function PlayerBar() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const rail = useAppStore((state) => state.rail)
  const track = snapshot?.track ?? null

  return (
    <div className="relative z-20 px-3 pb-3">
      <section className="glass flex h-[92px] items-center gap-4 rounded-[24px] border border-hairline px-4 shadow-[0_24px_70px_-34px_rgba(0,0,0,0.95)]">
        <div className="flex w-[258px] shrink-0 items-center gap-3">
          {track ? (
            <>
              <div className="relative shrink-0">
                <div className="absolute -inset-1 rounded-xl opacity-70 blur-lg" style={{ background: 'var(--accent-soft)' }} />
                <Cover
                  cover={track.cover}
                  title={track.title}
                  className="relative h-[52px] w-[52px] rounded-lg border border-white/12"
                  glyphClassName="text-[20px] font-semibold text-white/60"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-white/90">{track.title}</div>
                <div className="truncate text-[11px] text-white/38">{track.artist}</div>
              </div>
              <ReactionButtons track={track} size={15} className="hidden 2xl:flex" />
            </>
          ) : (
            <>
              <div className="h-[52px] w-[52px] shrink-0 rounded-lg border border-white/10 bg-white/[0.03]" />
              <div className="min-w-0">
                <div className="text-[12.5px] text-white/55">还没有在播放</div>
                <div className="text-[11px] text-white/28">去搜索里挑一首</div>
              </div>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <Transport />
          <PlaybackProgress />
        </div>

        <div className="flex w-[264px] shrink-0 items-center justify-end gap-1.5">
          <RailToggle tab="lyrics" active={rail === 'lyrics'}>
            <Icon name="lyrics" size={16} />
          </RailToggle>
          <RailToggle tab="queue" active={rail === 'queue'}>
            <Icon name="queue" size={16} />
          </RailToggle>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <VolumeControl />
          <span className="hidden rounded-full border border-white/10 px-2 py-[1px] font-mono text-[9px] text-white/34 xl:inline">
            {snapshot?.quality_kbps ? `${snapshot.quality_kbps}K` : '—'}
          </span>
        </div>
      </section>
    </div>
  )
}
