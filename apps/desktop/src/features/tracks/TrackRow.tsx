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
      className="group flex items-center gap-3 border-b border-hairline px-4"
    >
      <span className="num flex w-4 shrink-0 items-center justify-center font-mono text-[10px] text-white/28">
        {active && playing ? <Equalizer size="sm" /> : <span className={active ? 'text-[var(--accent)]' : ''}>{index + 1}</span>}
      </span>

      <button
        type="button"
        onClick={onPlay}
        aria-label={`播放 ${track.title}`}
        title={`播放 ${track.title}`}
        className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[6px] border border-white/10"
      >
        <Cover
          cover={track.cover}
          title={track.title}
          className="h-full w-full"
          glyphClassName="text-[16px] font-medium text-white/55"
        />
      </button>

      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span
          className={[
            't block truncate text-[13px]',
            active ? 'text-[var(--accent)]' : 'text-white/70 group-hover:text-white',
          ].join(' ')}
          title={track.title}
        >
          {track.title}
        </span>
        <span className="mt-1 block truncate text-[10.5px] text-white/36 group-hover:text-white/55" title={track.artist}>
          {track.artist}
        </span>
      </button>

      <span className="num hidden w-10 shrink-0 text-right font-mono text-[10px] text-white/30 sm:block">
        {formatDuration(track.duration_ms)}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <ReactionButtons track={track} size={14} />
        <button
          type="button"
          aria-label="加入歌单"
          title="加入歌单"
          onClick={() => setAdding(true)}
          className="t press rounded-[4px] p-1.5 text-white/30 hover:text-white"
        >
          <Icon name="plus" size={14} />
        </button>
        <DownloadButton trackKey={track.key} size={14} />
      </div>

      <AddToPlaylistModal track={track} open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
