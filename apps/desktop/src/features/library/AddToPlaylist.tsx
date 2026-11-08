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
      <div className="flex flex-col">
        {playlists === null ? (
          <div className="space-y-2 py-1" aria-hidden>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : playlists.length === 0 ? (
          <p className="border-b border-hairline py-4 text-center text-[12px] text-[var(--text-2)]">还没有歌单，在下面直接建一个。</p>
        ) : (
          playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              disabled={busy}
              onClick={() => void choose(playlist.id)}
              className="t group flex items-center gap-2 border-b border-hairline px-1 py-1 text-left text-[13px] text-[var(--text-2)] hover:text-white disabled:opacity-40"
            >
              <Icon name="library" size={15} className="text-[var(--text-2)] group-hover:text-[var(--text-2)]" />
              <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
              <Icon name="plus" size={13} className="text-[var(--text-2)] group-hover:text-[var(--text-2)]" />
            </button>
          ))
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void createAndAdd()
        }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          value={name}
          maxLength={32}
          onChange={(event) => setName(event.target.value)}
          placeholder="新建歌单并加入"
          aria-label="新歌单名"
          className="t min-w-0 flex-1 rounded-[4px] border border-[var(--line)] bg-white/[0.03] px-3 py-1 text-[13px] text-[var(--text-1)] placeholder:text-[var(--text-2)] focus:border-[var(--line)]"
        />
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="t press shrink-0 rounded-[4px] bg-white h-8 px-4 text-[12px] font-medium text-black hover:bg-white/85 disabled:cursor-default disabled:opacity-30"
        >
          新建
        </button>
      </form>
    </Modal>
  )
}
