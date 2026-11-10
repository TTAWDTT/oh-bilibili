import { useState } from 'react'
import { WaveRibbon } from './WaveRibbon'
import { LevelBars } from './LevelBars'
import { useAppStore } from '../../app/appStore'
import { AddToPlaylistModal } from '../library/AddToPlaylist'
import type { RailTab } from '../../app/appStore'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { ReactionButtons } from '../../shared/ui/ReactionButtons'
import type { Track } from '../../shared/lib/contract'
import { PlaybackProgress } from './PlaybackProgress'
import { useIsListening, useHasSession, usePlayerStore } from './playerStore'
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
            : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
          : 'cursor-default text-[var(--text-2)]',
      ].join(' ')}
    >
      <Icon name={tab === 'lyrics' ? 'lyrics' : 'queue'} size={16} />
      {tab === 'queue' && count > 0 ? <span className="num text-[12px]">{count}</span> : null}
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
          <span className="block text-[14px] font-medium text-[var(--text-2)] group-hover:text-[var(--text-1)]">还没有在播放</span>
          <span className="mt-1 block text-[14px] text-[var(--text-2)] group-hover:text-[var(--text-2)]">去搜索里挑一首 →</span>
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
          glyphClassName="text-[26px] font-semibold text-[var(--text-2)]"
        />
        {playing ? (
          <span className="bili-playing-bars absolute bottom-0 left-0 right-0 flex items-end justify-center gap-[2px] bg-black/35 pb-[3px] pt-[6px]">
            <i /><i /><i />
          </span>
        ) : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="bili-marquee truncate text-[14px] font-medium leading-tight text-[var(--text-1)]" title={track.title}>
          {track.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="truncate text-[14px] text-[var(--text-2)]" title={track.artist}>
            {track.artist}
          </span>
          <span className="num shrink-0 rounded-[3px] border border-[var(--line)] px-2 py-0 font-mono text-[12px] text-[var(--text-2)]">
            {quality ? `${quality}K` : '——'}
          </span>
        </div>
      </div>
    </div>
  )
}

/** 播放倍速。点一下在 0.75 / 1.0 / 1.25 / 1.5 / 2.0 之间循环，B 站播放器也有这个。 */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

function SpeedButton() {
  const speed = usePlayerStore((state) => state.snapshot?.speed ?? 1)
  const setSpeed = usePlayerStore((state) => state.setSpeed)
  const playable = usePlayerStore((state) => state.snapshot?.track != null)
  const next = (): void => {
    const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number])
    void setSpeed(SPEEDS[(i + 1) % SPEEDS.length] ?? 1)
  }
  return (
    <button
      type="button"
      onClick={next}
      disabled={!playable}
      aria-label={`播放倍速 ${speed}x`}
      title="播放倍速"
      className={[
        'num t press flex h-8 shrink-0 items-center rounded-[4px] px-1.5 font-mono text-[12px]',
        playable ? 'text-[var(--text-2)] hover:text-[var(--accent)]' : 'cursor-default text-[var(--text-3)]',
        speed !== 1 ? 'text-[var(--accent)]' : '',
      ].join(' ')}
    >
      {speed}x
    </button>
  )
}

export function PlayerBar() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  // 播放条只在「真的在听」时出现：听模式，且这次会话活着。
  // 之前判据是「快照里有曲目」，而队列会在启动时恢复，于是刷视频时
  // 底部一直挂着一条无声的音频，看着像坏了。
  const listening = useIsListening()
  const hasSession = useHasSession()
  if (!listening || !hasSession) return null
  const rail = useAppStore((state) => state.rail)
  const [adding, setAdding] = useState(false)
  const queued = usePlayerStore((state) => state.queue?.items.length ?? 0)
  const track = snapshot?.track ?? null

  return (
    // 三等分列宽让控制区真正落在窗口中线，两侧对称才不会显得偏。
    <section className="relative z-20 grid h-14 shrink-0 overflow-hidden grid-cols-[minmax(0,1fr)_minmax(340px,1.7fr)_minmax(0,1fr)] items-center gap-6 border-t border-hairline bg-[var(--panel)] px-3">
      <AddToPlaylistModal track={track} open={adding} onClose={() => setAdding(false)} />
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
        <span className="hidden md:block">
          <LevelBars />
        </span>
        <span className="hidden items-center gap-2 md:flex">
          <SpeedButton />
          <VolumeControl />
        </span>
        <span className="h-5 w-px bg-[var(--line)]" />
        <button
          type="button"
          aria-label="加入歌单"
          title={track ? '加入歌单' : '播放一首歌后可加入歌单'}
          disabled={!track}
          onClick={() => setAdding(true)}
          className={[
            't press flex h-8 w-8 items-center justify-center rounded-[4px]',
            track ? 'text-[var(--text-2)] hover:text-[var(--accent)]' : 'cursor-default text-[var(--text-2)]',
          ].join(' ')}
        >
          <Icon name="plus" size={16} />
        </button>
        <RailToggle tab="lyrics" active={rail === 'lyrics'} enabled={track !== null} />
        <RailToggle tab="queue" active={rail === 'queue'} count={queued} enabled={queued > 0} />
      </div>
    </section>
  )
}

