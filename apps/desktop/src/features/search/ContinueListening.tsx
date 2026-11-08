import type React from 'react'
import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { usePlayerStore } from '../player/playerStore'

/**
 * 继续听。B 站首页有「继续播放」区块，把上次没听完的接上。
 *
 * 数据来自本机的播放历史表，是真正播过的记录。
 */
export function ContinueListening() {
  const [tracks, setTracks] = useState<Track[]>([])
  const play = usePlayerStore((state) => state.play)

  useEffect(() => {
    let cancelled = false
    void ipc
      .libraryHistory(6)
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch(() => setTracks([]))
    return () => {
      cancelled = true
    }
  }, [])

  if (tracks.length === 0) return null

  return (
    <div className="mt-8">
      <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--text-2)]">继续听</div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
        {tracks.map((track, i) => (
          <button
            key={track.key}
            type="button"
            onClick={() => void play(track.key)}
            title={`${track.title} · ${track.artist}`}
            className="bili-card bili-card-enter bili-press w-[150px] shrink-0 text-left"
            style={{ '--i': i } as React.CSSProperties}
          >
            <span className="relative block overflow-hidden rounded-[8px]" style={{ aspectRatio: '16 / 10' }}>
              <Cover
                cover={track.cover}
                title={track.title}
                className="h-full w-full"
                glyphClassName="text-[28px] font-semibold text-white/85"
              />
              <span className="num absolute bottom-1 right-1 rounded-[3px] bg-black/60 px-1 text-[12px] leading-[14px] text-white">
                {formatDuration(track.duration_ms)}
              </span>
            </span>
            <span className="mt-1.5 line-clamp-1 block text-[14px] text-[var(--text-1)]">{track.title}</span>
            <span className="block truncate text-[12px] text-[var(--text-3)]">{track.artist}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
