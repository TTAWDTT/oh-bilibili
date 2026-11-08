import type { Track } from '../../shared/lib/contract'
import { VirtualList } from '../../shared/ui/VirtualList'
import { TRACK_ROW_HEIGHT, TrackRow } from './TrackRow'

/** 超过这个行数切窗口化；少于此值一次性渲染更简单，也少一层包装。 */
const VIRTUAL_THRESHOLD = 100

type TrackListProps = {
  tracks: readonly Track[]
  activeKey: string | null
  playing: boolean
  onPlay: (index: number) => void
}

export function TrackList({ tracks, activeKey, playing, onPlay }: TrackListProps) {
  const row = (track: Track, index: number) => (
    <TrackRow
      key={track.key}
      track={track}
      index={index}
      active={track.key === activeKey}
      playing={playing}
      onPlay={() => onPlay(index)}
    />
  )

  if (tracks.length > VIRTUAL_THRESHOLD) {
    return <VirtualList items={tracks} rowHeight={TRACK_ROW_HEIGHT} renderRow={row} />
  }

  return <div className="flex flex-col">{tracks.map((track, index) => row(track, index))}</div>
}
