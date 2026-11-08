import { useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Equalizer } from '../../shared/ui/Equalizer'
import { Icon } from '../../shared/ui/Icon'
import { ReactionButtons } from '../../shared/ui/ReactionButtons'
import { DownloadButton } from '../downloads/DownloadButton'
import { AddToPlaylistModal } from '../library/AddToPlaylist'

/** 行高固定，既给窗口化一个准确的分页单位，也让 hover 不可能改变行高。 */
export const TRACK_ROW_HEIGHT = 56

type TrackRowProps = {
  track: Track
  index: number
  active: boolean
  playing: boolean
  onPlay: () => void
}

export function TrackRow({ track, index, active, playing, onPlay }: TrackRowProps) {
  const [adding, setAdding] = useState(false)

  return (
    <div
      aria-current={active ? 'true' : undefined}
      style={{ height: TRACK_ROW_HEIGHT }}
      className={[
        'group flex items-center gap-3 rounded-xl px-3',
        active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05] active:bg-white/[0.09]',
      ].join(' ')}
    >
      <span className="num flex w-4 shrink-0 items-center justify-center font-mono text-[10px] text-white/28">
        {active ? <Equalizer size="sm" /> : index + 1}
      </span>

      <button
        type="button"
        onClick={onPlay}
        aria-label={`播放 ${track.title}`}
        title={`播放 ${track.title}`}
        className="t press relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 hover:border-white/30"
      >
        <Cover
          cover={track.cover}
          title={track.title}
          className="h-full w-full"
          glyphClassName="text-[16px] font-medium text-white/55"
        />
        <span className="t absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {active && playing ? <Equalizer size="sm" /> : <Icon name="play" size={13} />}
        </span>
      </button>

      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span
          className={['t block truncate text-[13px]', active ? 'text-[var(--accent)]' : 'text-white/84 hover:text-white'].join(' ')}
          title={track.title}
        >
          {track.title}
        </span>
        <span className="mt-1 block truncate text-[10.5px] text-white/36" title={track.artist}>
          {track.artist}
        </span>
      </button>

      <span className="num hidden w-10 shrink-0 text-right font-mono text-[10px] text-white/30 sm:block">
        {formatDuration(track.duration_ms)}
      </span>

      <div className="t flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
        <ReactionButtons track={track} size={14} />
        <button
          type="button"
          aria-label="加入歌单"
          title="加入歌单"
          onClick={() => setAdding(true)}
          className="t press rounded-full p-1.5 text-white/34 hover:bg-white/8 hover:text-white/80"
        >
          <Icon name="plus" size={14} />
        </button>
        <DownloadButton trackKey={track.key} size={14} />
      </div>

      <AddToPlaylistModal track={track} open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
