import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { PlaylistRowsSkeleton } from '../../shared/ui/Skeleton'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { useLibraryStore } from './libraryStore'

export function LibraryView() {
  const playlists = useLibraryStore((state) => state.playlists)
  const revision = useLibraryStore((state) => state.revision)
  const navigate = useAppStore((state) => state.navigate)
  const [tracksByList, setTracksByList] = useState<Record<number, readonly Track[]>>({})
  const [creating, setCreating] = useState(false)

  // 曲目数是列表行的第二列，逐张读一次；读失败只影响这一列，不挡住整页。
  useEffect(() => {
    if (!playlists) return
    let alive = true
    Promise.all(playlists.map(async (playlist) => [playlist.id, await ipc.libraryTracks(playlist.id)] as const))
      .then((entries) => {
        if (alive) setTracksByList(Object.fromEntries(entries))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [playlists, revision])

  return (
    <div className="flex h-full flex-col">
      <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
        <PageTitle
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="t press flex h-8 items-center gap-2 rounded-[4px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Icon name="plus" size={14} />
              新建歌单
            </button>
          }
        >
          曲库
        </PageTitle>
        {playlists === null ? (
          <div className="mt-8">
            <PlaylistRowsSkeleton rows={4} />
          </div>
        ) : playlists.length === 0 ? (
          <div className="pt-6">
            <EmptyState
              mascot="cheer"
              icon="library"
              title="还没有歌单"
              /* 标题行已经有「新建歌单」，这里不再放第二个同样的按钮。 */
              action={null}
            />
          </div>
        ) : (
          <section className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
            {playlists.map((playlist) => {
              const tracks = tracksByList[playlist.id]
              const count = tracks ? tracks.length : 0
              return (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => navigate({ kind: 'playlist', id: playlist.id, name: playlist.name })}
                  className="bili-card bili-card-enter bili-press overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] text-left"
                >
                  {/* 封面拼图区：四宫格铺满卡片上半部 */}
                  <span className="grid aspect-[16/10] w-full grid-cols-2 gap-px bg-[var(--ga2)]">
                    {Array.from({ length: 4 }, (_, i) => {
                      const cover = tracks?.[i]?.cover
                      return (
                        <span key={i} className="relative block overflow-hidden bg-[var(--ga1)]">
                          {cover ? (
                            <img
                              src={cover}
                              alt=""
                              aria-hidden
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </span>
                      )
                    })}
                  </span>
                  <span className="block px-3 py-2">
                    <span className="line-clamp-1 text-[14px] font-medium text-[var(--text-1)]" title={playlist.name}>
                      {playlist.name}
                    </span>
                    <span className="num mt-0.5 block text-[12px] text-[var(--text-3)]">
                      {count > 0 ? `${count} 首` : '空歌单'}
                    </span>
                  </span>
                </button>
              )
            })}
          </section>
        )}

        <CreatePlaylistModal open={creating} onClose={() => setCreating(false)} />
      </div>
    </div>
  )
}
