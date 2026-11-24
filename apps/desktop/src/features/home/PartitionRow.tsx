import { TrackByline } from '../tracks/TrackByline'
import { TrackDirectory } from '../tracks/TrackDirectory'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { formatCount, formatDuration } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import './discovery-shelves.css'

type PartitionRowProps = {
  rid: number
  title: string
  illustration: string
}

export function PartitionRow({ rid, title, illustration }: PartitionRowProps) {
  const navigate = useAppStore((state) => state.navigate)
  const [tracks, setTracks] = useState<Track[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    void ipc
      .ranking(rid)
      .then((list) => {
        if (!cancelled) setTracks(list.slice(0, 5))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [rid])

  if (!tracks || tracks.length < 5) return null

  return (
    <section aria-labelledby={`home-partition-${rid}`} className="discovery-shelf px-4 md:px-8">
      <div className="discovery-shelf-heading">
        <h2 id={`home-partition-${rid}`} className="discovery-heading">
          <img src={`/assets/illustrations/${illustration}.png`} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
          {title}
        </h2>
        <button
          type="button"
          onClick={() => navigate({ kind: 'ranking', rid })}
        >
          {title}排行榜 <Icon name="chevronRight" size={14} />
        </button>
      </div>
      <div className="discovery-partition-list">
        {tracks.map((track) => (
          <div key={track.key} className="min-w-0">
            <button
              type="button"
              data-focus-id={`partition:${rid}:${track.key}`}
              onClick={() => navigate({ kind: 'watch', track }, undefined, `partition:${rid}:${track.key}`)}
              className="group block w-full text-left"
            >
              <span className="discovery-landscape-cover">
                <Cover cover={track.cover} title={track.title} width={300} className="h-full w-full" />
                <span className="discovery-cover-stats justify-between">
                  <span className="num flex min-w-0 items-center gap-1">
                    {track.views ? (
                      <>
                        <Icon name="play" size={10} className="shrink-0" />
                        <span className="truncate">{formatCount(track.views)}</span>
                      </>
                    ) : null}
                    {(track.danmaku ?? 0) > 0 ? (
                      <>
                        <Icon name="danmaku" size={11} className="ml-0.5 shrink-0" />
                        <span className="truncate">{formatCount(track.danmaku!)}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="num shrink-0 rounded-[2px] bg-black/60 px-1 [text-shadow:none]">
                    {formatDuration(track.duration_ms)}
                  </span>
                </span>
              </span>
              <span className="discovery-card-title">{track.title}</span>
            </button>
            <TrackDirectory track={track} sourceId={`partition:${rid}:${track.key}`} />
            <div className="discovery-card-meta">
              <TrackByline track={track} focusId={`partition-author:${rid}:${track.key}`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
