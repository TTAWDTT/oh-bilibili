import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { useLibraryStore } from './libraryStore'
import { Modal } from '../../shared/ui/Modal'
import { Icon } from '../../shared/ui/Icon'
import { Skeleton } from '../../shared/ui/Skeleton'

type AddToPlaylistModalProps = {
  track: Track | null
  open: boolean
  onClose: () => void
}

export function AddToPlaylistModal({ track, open, onClose }: AddToPlaylistModalProps) {
  const playlists = useLibraryStore((state) => state.playlists)
  const add = useLibraryStore((state) => state.add)
  const create = useLibraryStore((state) => state.create)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setBusy(false)
    }
  }, [open])

  if (!track) return null

  const choose = async (playlistId: number): Promise<void> => {
    const playlist = playlists?.find((item) => item.id === playlistId)
    if (!playlist || busy) return
    setBusy(true)
    const ok = await add(playlist, track.key)
    setBusy(false)
    if (ok) onClose()
  }

  const createAndAdd = async (): Promise<void> => {
    if (name.trim().length === 0 || busy) return
    setBusy(true)
    const playlist = await create(name)
    if (playlist) {
      const ok = await add(playlist, track.key)
      if (ok) onClose()
    }
    setBusy(false)
  }

  return (
    <Modal open={open} title="加入歌单" description={`${track.title} · ${track.artist}`} onClose={onClose}>
      <div className="flex flex-col gap-1">
        {playlists === null ? (
          <div className="space-y-2 py-1">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ) : playlists.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/12 px-4 py-4 text-center text-[12px] text-white/34">
            还没有歌单，在下面直接建一个。
          </p>
        ) : (
          playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              disabled={busy}
              onClick={() => void choose(playlist.id)}
              className="t press flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12.5px] text-white/78 hover:bg-white/[0.06] disabled:opacity-40"
            >
              <Icon name="library" size={15} className="text-white/32" />
              <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
              <Icon name="plus" size={13} className="text-white/24" />
            </button>
          ))
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void createAndAdd()
        }}
        className="mt-4 flex items-center gap-2 border-t border-hairline pt-4"
      >
        <input
          value={name}
          maxLength={32}
          onChange={(event) => setName(event.target.value)}
          placeholder="新建歌单并加入"
          aria-label="新歌单名"
          className="t min-w-0 flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[12.5px] text-white/90 placeholder:text-white/26 focus:border-white/28"
        />
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="t press shrink-0 rounded-xl bg-white px-4 py-2.5 text-[12px] font-medium text-black hover:bg-white/88 disabled:cursor-default disabled:opacity-30"
        >
          新建
        </button>
      </form>
    </Modal>
  )
}
