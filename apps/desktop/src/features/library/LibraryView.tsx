import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { PlaylistRowsSkeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { useLibraryStore } from './libraryStore'

export function LibraryView() {
  const playlists = useLibraryStore((state) => state.playlists)
  const revision = useLibraryStore((state) => state.revision)
  const navigate = useAppStore((state) => state.navigate)
  const playContext = usePlayerStore((state) => state.playContext)
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
    <div className="h-full overflow-y-auto px-8 pb-10 pt-8">
      <PageHeader
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="t press flex items-center gap-2 rounded-[6px] border border-white/14 px-4 py-2 text-[12px] text-white/84 hover:border-white/30 hover:text-white"
          >
            <Icon name="plus" size={14} />
            新建歌单
          </button>
        }
      />

      {playlists === null ? (
        <div className="mt-8">
          <PlaylistRowsSkeleton rows={4} />
        </div>
      ) : playlists.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <EmptyState
            icon="library"
            title="还没有歌单"
            detail="建一个歌单，把歌按自己的顺序收起来。"
            action={{ label: '新建歌单', onClick: () => setCreating(true) }}
          />
        </div>
      ) : (
        <section className="mt-8 max-w-[900px]">
          <div className="flex items-center gap-4 border-b border-hairline px-4 pb-2 text-[10px] uppercase tracking-[0.2em] text-white/32">
            <span className="flex-1">歌单</span>
            <span className="num w-16 text-right">曲目</span>
            <span className="w-[68px]" />
          </div>
          {playlists.map((playlist) => {
            const tracks = tracksByList[playlist.id]
            const count = tracks ? `${tracks.length} 首` : '——'
            return (
              <div key={playlist.id} className="group flex items-center gap-4 border-b border-hairline px-4">
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'playlist', id: playlist.id, name: playlist.name })}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left"
                >
                  <span className="text-white/26 group-hover:text-white/60">
                    <Icon name="library" size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-white/70 group-hover:text-white" title={playlist.name}>
                    {playlist.name}
                  </span>
                  <span className="num w-16 shrink-0 text-right font-mono text-[10.5px] text-white/32">{count}</span>
                </button>
                <div className="flex w-[68px] shrink-0 items-center justify-end gap-0.5">
                  <button
                    type="button"
                    aria-label={`播放 ${playlist.name}`}
                    title="播放歌单"
                    disabled={!tracks || tracks.length === 0}
                    onClick={() => {
                      if (!tracks || tracks.length === 0) return
                      void playContext(
                        tracks.map((track) => track.key),
                        0,
                      )
                    }}
                    className="t press rounded-[4px] p-1.5 text-white/34 hover:text-white disabled:cursor-default disabled:opacity-20"
                  >
                    <Icon name="play" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`打开 ${playlist.name}`}
                    title="打开歌单"
                    onClick={() => navigate({ kind: 'playlist', id: playlist.id, name: playlist.name })}
                    className="t press rounded-[4px] p-1.5 text-white/34 hover:text-white"
                  >
                    <Icon name="chevronRight" size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <CreatePlaylistModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
