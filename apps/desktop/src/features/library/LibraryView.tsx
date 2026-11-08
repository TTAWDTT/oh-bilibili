import { useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { hueFor } from '../../shared/lib/format'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { PlaylistGridSkeleton } from '../../shared/ui/Skeleton'
import { CreatePlaylistModal } from './CreatePlaylistModal'
import { useLibraryStore } from './libraryStore'

function PlaylistCard({ name, onClick }: { name: string; onClick: () => void }) {
  const hue = hueFor(name)
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-hairline bg-white/[0.025] p-3.5 text-left transition duration-300 hover:border-white/18 hover:bg-white/[0.05]"
    >
      <div
        className="relative aspect-square overflow-hidden rounded-xl"
        style={{ background: `linear-gradient(145deg, hsl(${hue} 60% 20%), hsl(${(hue + 46) % 360} 78% 40%))` }}
      >
        <div className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/12 blur-xl" />
        <div className="absolute inset-0 flex items-center justify-center text-white/30">
          <Icon name="library" size={34} />
        </div>
        <div className="absolute bottom-2 right-2 rounded-full bg-black/35 p-1.5 text-white/75 opacity-0 backdrop-blur transition duration-200 group-hover:opacity-100">
          <Icon name="play" size={13} />
        </div>
      </div>
      <div className="mt-3 truncate text-[13px] text-white/84">{name}</div>
      <div className="mt-0.5 text-[10.5px] text-white/30">歌单</div>
    </button>
  )
}

export function LibraryView() {
  const playlists = useLibraryStore((state) => state.playlists)
  const navigate = useAppStore((state) => state.navigate)
  const [creating, setCreating] = useState(false)

  return (
    <div className="h-full overflow-y-auto px-8 pb-10 pt-7">
      <PageHeader
        eyebrow="曲库"
        title="歌单"
        subtitle="全部存在本机，按你自己的顺序收着。登录后喜欢与收藏会同步到 B 站账号。"
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-[12px] text-white/82 transition hover:border-white/24 hover:bg-white/[0.1]"
          >
            <Icon name="plus" size={14} />
            新建歌单
          </button>
        }
      />

      {playlists === null ? (
        <div className="mt-7">
          <PlaylistGridSkeleton cards={6} />
        </div>
      ) : playlists.length === 0 ? (
        <EmptyState
          icon="library"
          title="还没有歌单"
          detail="建一个歌单，把歌按自己的顺序收起来。"
          action={{ label: '新建歌单', onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              name={playlist.name}
              onClick={() => navigate({ kind: 'playlist', id: playlist.id, name: playlist.name })}
            />
          ))}
        </div>
      )}

      <CreatePlaylistModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
