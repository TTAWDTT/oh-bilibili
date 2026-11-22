import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { useLibraryStore } from './libraryStore'
import { Modal } from '../../shared/ui/Modal'

type CreatePlaylistModalProps = {
  open: boolean
  onClose: () => void
}

export function CreatePlaylistModal({ open, onClose }: CreatePlaylistModalProps) {
  const create = useLibraryStore((state) => state.create)
  const navigate = useAppStore((state) => state.navigate)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setBusy(false)
    }
  }, [open])

  const submit = async (): Promise<void> => {
    if (busy || name.trim().length === 0) return
    setBusy(true)
    const playlist = await create(name)
    setBusy(false)
    if (playlist) {
      onClose()
      navigate({ kind: 'playlist', id: playlist.id, name: playlist.name })
    }
  }

  return (
    <Modal
      open={open}
      title="新建歌单"
      description="歌单只存在本机；登录后点赞与收藏会同步到 B 站账号。"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <input
          autoFocus
          value={name}
          maxLength={32}
          onChange={(event) => setName(event.target.value)}
          placeholder="给歌单起个名字"
          aria-label="歌单名"
          className="t w-full rounded-[4px] border border-[var(--line)] bg-[var(--ga1)] px-4 py-3 text-[14px] text-[var(--text-1)] placeholder:text-[var(--text-2)] focus:border-[var(--accent)]"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="t press rounded-[4px] h-8 px-4 text-[14px] text-[var(--text-2)] hover:text-[var(--text-1)]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="t press h-8 rounded-[4px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90 disabled:cursor-default disabled:opacity-35"
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
