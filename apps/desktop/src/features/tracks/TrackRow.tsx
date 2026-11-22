import { useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Equalizer } from '../../shared/ui/Equalizer'
import { Icon } from '../../shared/ui/Icon'
import { ReactionButtons } from '../../shared/ui/ReactionButtons'
import { useAppStore } from '../../app/appStore'
import { DownloadButton } from '../downloads/DownloadButton'
import { AddToPlaylistModal } from '../library/AddToPlaylist'

/** 行高固定，既给窗口化一个准确的分页单位，也让 hover 不可能改变行高。 */
export const TRACK_ROW_HEIGHT = 40

type TrackRowProps = {
  track: Track
  index: number
  active: boolean
  playing: boolean
  onPlay: () => void
}

export function TrackRow({ track, index, active, playing, onPlay }: TrackRowProps) {
  const navigate = useAppStore((state) => state.navigate)
  const [adding, setAdding] = useState(false)

  return (
    <div
      aria-current={active ? 'true' : undefined}
      style={{ height: TRACK_ROW_HEIGHT }}
      className="group flex items-center gap-2 border-b border-hairline px-4"
      data-row="track"
    >
      <span className="num flex w-4 shrink-0 items-center justify-center font-mono text-[12px] text-[var(--text-2)]">
        {active && playing ? <Equalizer size="sm" /> : <span className={active ? 'text-[var(--accent)]' : ''}>{index + 1}</span>}
      </span>

      <button
        type="button"
        onClick={onPlay}
        aria-label={`播放 ${track.title}`}
        title={`播放 ${track.title}`}
        data-row="cover"
          className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[4px] border border-[var(--line)]"
      >
        <Cover
          cover={track.cover}
          title={track.title}
          className="h-full w-full"
        />
      </button>

      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span
          className={[
            't block truncate text-[14px]',
            active ? 'text-[var(--accent)]' : 'text-[var(--text-2)] group-hover:text-[var(--text-1)]',
          ].join(' ')}
          title={track.title}
        >
          {track.title}
        </span>
        <span className="mt-0 block truncate text-[12px] text-[var(--text-2)] group-hover:text-[var(--text-2)]" title={track.artist}>
          {track.artist}
        </span>
      </button>

      <span className="num hidden w-10 shrink-0 text-right font-mono text-[12px] text-[var(--text-2)] sm:block">
        {formatDuration(track.duration_ms)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <ReactionButtons track={track} size={14} />
        <button
          type="button"
          aria-label="加入歌单"
          title="加入歌单"
          onClick={() => setAdding(true)}
          className="t press flex items-center justify-center rounded-[4px] h-6 w-6 text-[var(--text-2)] hover:text-[var(--text-1)]"
        >
          <Icon name="plus" size={14} />
        </button>
  
      <button
        type="button"
        aria-label={`看视频 ${track.title}`}
        title="看视频"
        onClick={() => navigate({ kind: 'watch', track }, undefined, `row:${track.key}`)}
        data-focus-id={`row:${track.key}`}
        className="t press flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:text-[var(--text-1)]"
      >
        <Icon name="play" size={13} />
      </button>
      <DownloadButton trackKey={track.key} size={14} />
      </div>

      <AddToPlaylistModal track={track} open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
