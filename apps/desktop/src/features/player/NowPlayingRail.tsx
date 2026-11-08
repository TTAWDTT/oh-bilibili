import type { RailTab } from '../../app/appStore'
import { useAppStore } from '../../app/appStore'
import { Cover } from '../../shared/ui/Cover'
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
      className={[
        'rounded-full px-3 py-1 text-[11.5px] transition duration-200',
        active ? 'bg-white/12 text-white/90' : 'text-white/38 hover:bg-white/[0.06] hover:text-white/70',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

export function NowPlayingRail({ tab }: { tab: RailTab }) {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const queue = usePlayerStore((state) => state.queue)
  const toggleRail = useAppStore((state) => state.toggleRail)
  const closeRail = useAppStore((state) => state.closeRail)
  const track = snapshot?.track ?? null
  const loading = snapshot?.phase === 'loading'

  return (
    <aside className="glass flex w-[336px] shrink-0 flex-col overflow-hidden rounded-[26px] border border-hairline">
      <div className="flex items-center justify-between px-3 pt-3">
        <div className="flex items-center gap-1">
          <RailTabButton active={tab === 'lyrics'} label="歌词" onClick={() => toggleRail('lyrics')} />
          <RailTabButton
            active={tab === 'queue'}
            label={queue ? `队列 ${queue.items.length}` : '队列'}
            onClick={() => toggleRail('queue')}
          />
        </div>
        <button
          type="button"
          aria-label="收起右栏"
          title="收起右栏"
          onClick={closeRail}
          className="rounded-full p-1.5 text-white/30 transition hover:bg-white/8 hover:text-white/70"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {track ? (
        <>
          <div className="flex gap-4 px-5 pt-3">
            <div className="relative shrink-0">
              <div
                className="absolute -inset-3 rounded-2xl opacity-60 blur-2xl"
                style={{ background: 'var(--accent-soft)' }}
              />
              <Cover
                cover={track.cover}
                title={track.title}
                className="relative h-[92px] w-[92px] rounded-xl border border-white/12"
                glyphClassName="text-[34px] font-semibold text-white/60"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] tracking-[0.16em] text-white/28">
                正在播放
                {loading ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft" /> : null}
              </div>
              <div className="mt-1 font-display text-[23px] font-semibold leading-[1.18] tracking-[-0.02em] text-white/94">
                {track.title}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-white/40">{track.artist}</div>
              <div className="mt-1.5 flex items-center gap-1">
                <ReactionButtons track={track} size={15} />
                {snapshot?.quality_kbps ? (
                  <span className="ml-1 rounded-full border border-white/10 px-2 py-[1px] font-mono text-[9px] text-white/34">
                    {snapshot.quality_kbps}K
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1 border-t border-hairline">
            {tab === 'lyrics' ? <LyricsView track={track} /> : <QueueList />}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
            <span
              className="animate-spin rounded-full border border-dashed border-white/12"
              style={{ position: 'absolute', inset: 0, animationDuration: '22s' }}
            />
            <Icon name="music" size={28} className="text-white/30" />
          </div>
          <div className="mt-5 text-[13px] text-white/55">还没有在播放</div>
          <div className="mt-1.5 max-w-[200px] text-[11px] leading-relaxed text-white/28">
            从搜索或歌单里挑一首，歌词与队列会在这里展开。
          </div>
        </div>
      )}
    </aside>
  )
}
