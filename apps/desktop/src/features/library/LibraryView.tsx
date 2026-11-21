import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Playlist, Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { useLibraryStore } from './libraryStore'
import { usePlayerStore } from '../player/playerStore'
import { PlaylistSleeve } from './PlaylistSleeve'

export function LibraryView() {
  const playlists = useLibraryStore((state) => state.playlists)
  const revision = useLibraryStore((state) => state.revision)
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <div
        id="scroll-main"
        className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
      >
        <PageTitle
          action={
            playlists && playlists.length > 0 ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="t press flex h-8 items-center gap-2 rounded-[4px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Icon name="plus" size={14} />
                新建歌单
              </button>
            ) : null
          }
        >
          曲库
        </PageTitle>
        {playlists === null ? (
          <div className="mt-8">
            <BiliLoader compact label="正在取歌单…" />
          </div>
        ) : playlists.length === 0 ? (
          <div className="pt-6">
            <EmptyState
              mascot="cheer"
              icon="library"
              title="还没有歌单"
              action={{ label: '新建歌单', onClick: () => setCreating(true) }}
            />
          </div>
        ) : (
          <section className="mt-6 grid max-w-[1120px] grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-4 gap-y-7">
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} revision={revision} />
            ))}
          </section>
        )}

        <CreatePlaylistModal open={creating} onClose={() => setCreating(false)} />
      </div>
    </div>
  )
}

function PlaylistCard({ playlist, revision }: { playlist: Playlist; revision: number }) {
  const { id, name } = playlist
  const navigate = useAppStore((state) => state.navigate)
  const playContext = usePlayerStore((state) => state.playContext)
  const [trackRead, setTrackRead] = useState<readonly Track[] | 'failed'>()
  const [retryCount, setRetryCount] = useState(0)
  const failed = trackRead === 'failed'
  const tracks = failed ? undefined : trackRead

  useEffect(() => {
    let alive = true
    void ipc.libraryTracks(id).then(
      (next) => {
        if (alive) setTrackRead(next)
      },
      () => {
        if (alive) setTrackRead('failed')
      },
    )
    return () => {
      alive = false
    }
  }, [id, revision, retryCount])

  const playPlaylist = async (): Promise<void> => {
    const list = tracks ?? (await ipc.libraryTracks(id).catch(() => []))
    if (list.length === 0) return
    await playContext(
      list.map((t) => t.key),
      0,
    )
  }

  return (
    <article
      data-playlist-name={name}
      className="bili-playlist-card bili-card-enter group relative min-w-0"
    >
      <button
        type="button"
        onClick={() => navigate({ kind: 'playlist', id, name })}
        className="block w-full text-left"
      >
        <PlaylistSleeve name={name} tracks={tracks} />
        <span className="mt-2 block">
          <span className="line-clamp-2 min-h-[40px] text-[14px] font-medium leading-5 text-[var(--text-1)]" title={name}>
            {name}
          </span>
          <span data-track-count className="num mt-0.5 block min-h-[1.5em] text-[12px] text-[var(--text-3)]">
            {failed ? '曲目数未取到' : tracks && (tracks.length > 0 ? `${tracks.length} 首` : '空歌单')}
          </span>
        </span>
      </button>
      {failed ? (
        <button
          type="button"
          aria-label={`重试读取 ${name} 的曲目数`}
          onClick={() => {
            setTrackRead(undefined)
            setRetryCount((current) => current + 1)
          }}
          className="t mt-1 rounded-[4px] text-[12px] text-[var(--accent-strong)] hover:underline"
        >
          重试
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`播放歌单 ${name}`}
        title={tracks && tracks.length > 0 ? '播放全部' : '歌单里还没有可播放的曲目'}
        disabled={!tracks || tracks.length === 0}
        onClick={() => void playPlaylist()}
        className="bili-playlist-play bili-press absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_2px_10px_rgba(0,0,0,0.25)] disabled:cursor-default disabled:opacity-35"
      >
        <Icon name="play" size={16} />
      </button>
    </article>
  )
}
