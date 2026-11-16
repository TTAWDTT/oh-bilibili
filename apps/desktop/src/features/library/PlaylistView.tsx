import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatSpan } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { useAppStore } from '../../app/appStore'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { BiliLoader } from '../../shared/ui/BiliLoader'
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
      <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 md:px-8">
        <PageTitle
          extra={tracks ? `${tracks.length} 首 · ${formatSpan(total)}` : null}
          action={
            tracks !== null && tracks.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => void playContext(keys, 0)}
                  className="t press flex h-8 items-center gap-2 rounded-[4px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90"
                >
                  <Icon name="play" size={13} />
                  播放全部
                </button>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'search' })}
                  className="t press h-8 rounded-[4px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  去添加
                </button>
              </>
            ) : null
          }
        >
          {name}
        </PageTitle>
        <div className="flex min-h-0 flex-col">
          {tracks === null ? <BiliLoader label="正在取歌单…" /> : null}

          {error ? (
            <div className="pt-6">
              <EmptyState
                icon="alert"
                title={error}
                detail="歌单读取失败了，稍后再试一次。"
                action={{ label: '重试', onClick: () => setNonce((current) => current + 1) }}
              />
            </div>
          ) : null}

          {tracks !== null && !error && tracks.length === 0 ? (
            <div className="pt-6">
              <EmptyState
                mascot="cheer"
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
