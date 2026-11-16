import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { partColor } from '../../shared/lib/biliParts'
import { formatCount, formatDuration } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'

type PartitionRowProps = {
  rid: number
  title: string
}

export function PartitionRow({ rid, title }: PartitionRowProps) {
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
    <section className="mt-8 px-4 md:px-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[17px] font-medium text-[var(--text-1)]">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[14px] text-white"
            style={{ background: partColor(title) }}
          >
            {title[0]}
          </span>
          {title}
        </h2>
        <button
          type="button"
          onClick={() => navigate({ kind: 'ranking', rid })}
          className="t press flex items-center gap-1 text-[12.5px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          更多
          <span aria-hidden>›</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-5 lg:grid-cols-4">
        {tracks.map((track, index) => (
          <button
            key={track.key}
            type="button"
            onClick={() => navigate({ kind: 'watch', track })}
            className={`group flex min-w-0 flex-col text-left ${index === 0 ? 'col-span-2 lg:row-span-2' : ''}`}
          >
            <span
              className={`relative block w-full overflow-hidden rounded-[8px] bg-[var(--ga1)] ${
                index === 0
                  ? 'aspect-[16/9] lg:aspect-auto lg:min-h-[240px] lg:flex-1'
                  : 'aspect-[16/10] shrink-0'
              }`}
            >
              <span className="absolute inset-0 transition-transform duration-[220ms] group-hover:scale-[1.03]">
                <Cover cover={track.cover} title={track.title} width={index === 0 ? 640 : 320} className="h-full w-full" />
              </span>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.55))]" />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-1 text-[12px] leading-[15px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
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
            <span
              className={`mt-1.5 line-clamp-2 shrink-0 leading-[21px] text-[var(--text-1)] group-hover:text-[var(--accent)] ${
                index === 0 ? 'text-[16px]' : 'text-[14px]'
              }`}
            >
              {track.title}
            </span>
            <span className="mt-1 flex w-full items-center gap-1.5 text-[12px] text-[var(--text-3)]">
              <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[13px]">
                UP
              </span>
              <span className="truncate">{track.artist}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
