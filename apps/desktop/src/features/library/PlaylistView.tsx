import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatSpan } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { useAppStore } from '../../app/appStore'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'
import { useLibraryStore } from '../library/libraryStore'
import { TrackList } from '../tracks/TrackList'

type PlaylistViewProps = {
  id: number
  name: string
}

export function PlaylistView({ id, name }: PlaylistViewProps) {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const revision = useLibraryStore((state) => state.revision)
  const navigate = useAppStore((state) => state.navigate)
  const playContext = usePlayerStore((state) => state.playContext)
  const snapshot = usePlayerStore((state) => state.snapshot)

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    setError(null)
    ipc
      .libraryTracks(id)
      .then((next) => {
        if (!cancelled) setTracks(next)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setTracks([])
        setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [id, revision, nonce])

  const keys = tracks?.map((track) => track.key) ?? []
  const total = tracks?.reduce((sum, track) => sum + (track.duration_ms ?? 0), 0) ?? 0
  const activeKey = snapshot?.track?.key ?? null
  const playing = snapshot?.phase === 'playing'

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={tracks ? `${name} · ${tracks.length} 首 · ${formatSpan(total)}` : name}
        actions={
          tracks !== null && tracks.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => void playContext(keys, 0)}
                className="t press flex items-center gap-2 rounded-[4px] bg-white h-8 px-4 text-[14px] font-medium text-black hover:bg-white/85"
              >
                <Icon name="play" size={13} />
                播放全部
              </button>
              <button
                type="button"
                onClick={() => navigate({ kind: 'search' })}
                className="t press rounded-[4px] border border-[var(--line)] h-8 px-4 text-[14px] text-[var(--text-2)] hover:border-[var(--line)] hover:text-[var(--text-1)]"
              >
                去添加
              </button>
            </>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 pt-4">
        <button
          type="button"
          onClick={() => navigate({ kind: 'library' })}
          className="t press flex items-center justify-center mb-3 flex w-fit items-center gap-1 pr-2 text-[14px] text-[var(--text-2)] hover:text-[var(--text-1)]"
        >
          <Icon name="chevronLeft" size={13} />
          曲库
        </button>

        <div className="flex min-h-0 flex-col">
          {tracks === null ? <TrackListSkeleton rows={6} /> : null}

          {error ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <EmptyState
                icon="alert"
                title={error}
                detail="歌单读取失败了，稍后再试一次。"
                action={{ label: '重试', onClick: () => setNonce((current) => current + 1) }}
              />
            </div>
          ) : null}

          {tracks !== null && !error && tracks.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <EmptyState
                icon="music"
                title="这张歌单还是空的"
                detail="去搜索里找到喜欢的歌，点加号就能收进来。"
                action={{ label: '去搜索', onClick: () => navigate({ kind: 'search' }) }}
              />
            </div>
          ) : null}

          {tracks !== null && tracks.length > 0 ? (
            <TrackList
              tracks={tracks}
              activeKey={activeKey}
              playing={playing}
              onPlay={(index) => void playContext(keys, index)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
