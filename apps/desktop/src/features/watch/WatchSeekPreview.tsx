import { useState } from 'react'
import type { VideoShots } from '../../shared/lib/ipc'
import { formatTime } from '../../shared/lib/format'

export type PreviewTile = { image: string; col: number; row: number }

export function WatchSeekPreview({ ratio, time, chapter, tile, sheet }: {
  ratio: number
  time: number
  chapter: string | undefined
  tile: PreviewTile | null
  sheet: VideoShots | null
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <span
      data-watch-seek-preview
      aria-hidden="true"
      className="watch-seek-preview"
      data-compact={!loaded && !chapter}
      style={{ left: `clamp(var(--preview-half), ${ratio * 100}%, calc(100% - var(--preview-half)))` }}
    >
      {tile && sheet && (
        <span data-watch-seek-image hidden={!loaded} className="watch-seek-image">
          <img
            src={tile.image}
            alt=""
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            style={{
              width: `${sheet.columns * 100}%`, height: `${sheet.rows * 100}%`,
              left: `${-tile.col * 100}%`, top: `${-tile.row * 100}%`,
            }}
          />
        </span>
      )}
      <span className="watch-seek-caption">
        <span className="num">{formatTime(time)}</span>
        {chapter && <span className="truncate">{chapter}</span>}
      </span>
    </span>
  )
}
