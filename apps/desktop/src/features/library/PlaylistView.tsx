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
    <div className="flex h-full max-w-[1040px] flex-col px-8 pb-8 pt-8">
      <button
        type="button"
        onClick={() => navigate({ kind: 'library' })}
        className="t press mb-4 flex w-fit items-center gap-1 rounded-full pr-2 text-[11.5px] text-white/40 hover:text-white/76"
      >
        <Icon name="chevronLeft" size={13} />
        曲库
      </button>

      <PageHeader
        eyebrow="歌单"
        title={name}
        subtitle={
          tracks === null
            ? '正在读取本机歌单…'
            : tracks.length === 0
              ? '这张歌单还是空的。'
              : `${tracks.length} 首 · ${formatSpan(total)}`
        }
        actions={
          tracks !== null && tracks.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => void playContext(keys, 0)}
                className="t press flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/88"
              >
                <Icon name="play" size={13} />
                播放全部
              </button>
              <button
                type="button"
                onClick={() => navigate({ kind: 'search' })}
                className="t press rounded-full border border-white/12 px-4 py-2 text-[12px] text-white/72 hover:border-white/24 hover:text-white/92"
              >
                去添加
              </button>
            </>
          ) : null
        }
      />

      <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tracks === null ? <TrackListSkeleton rows={6} /> : null}

        {error ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon="alert"
              title={error}
              detail="歌单读取失败了，稍后再试一次。"
              action={{ label: '重试', onClick: () => setNonce((current) => current + 1) }}
            />
          </div>
        ) : null}

        {tracks !== null && !error && tracks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
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
  )
}
