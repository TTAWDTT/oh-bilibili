import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Playlist, Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { thumbUrl } from '../../shared/lib/thumb'
import { useLibraryStore } from './libraryStore'
import { usePlayerStore } from '../player/playerStore'

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
          <section className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
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
    <div
      className="bili-card bili-card-enter group relative overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)]"
    >
      <button
        type="button"
        onClick={() => navigate({ kind: 'playlist', id, name })}
        className="block w-full text-left"
      >
        <span className="grid aspect-[16/10] w-full grid-cols-2 gap-px bg-[var(--ga2)]">
          {Array.from({ length: 4 }, (_, i) => {
            const cover = tracks?.[i]?.cover
            return (
              <span key={i} className="relative block overflow-hidden bg-[var(--ga1)]">
                {cover ? (
                  <img
                    src={thumbUrl(cover, 320, 180) ?? cover}
                    alt=""
                    aria-hidden
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </span>
            )
          })}
        </span>
        <span className="block px-3 py-2">
          <span className="line-clamp-1 text-[14px] font-medium text-[var(--text-1)]" title={name}>
            {name}
          </span>
          <span className="num mt-0.5 block min-h-[1.5em] text-[12px] text-[var(--text-3)]">
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
          className="t absolute bottom-2 right-3 rounded-[4px] text-[12px] text-[var(--accent)] hover:underline"
        >
          重试
        </button>
      ) : null}
      {/* B 站歌单卡右上角也是就近播放：整单排进队列，不用先进详情页。 */}
      <span className="pointer-events-none absolute right-2 top-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <button
          type="button"
          aria-label={`播放歌单 ${name}`}
          title="播放全部"
          onClick={() => void playPlaylist()}
          className="bili-press flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_2px_10px_rgba(0,0,0,0.25)] hover:opacity-90"
        >
          <Icon name="play" size={16} />
        </button>
      </span>
    </div>
  )
}
