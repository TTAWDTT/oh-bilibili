import { useEffect, useState } from 'react'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import type { FavFolder } from '../../shared/lib/ipc'
import { Icon } from '../../shared/ui/Icon'
import { Modal } from '../../shared/ui/Modal'

/**
 * 收藏夹选择。B 站点收藏会弹出收藏夹列表，让你决定收进哪一个。
 *
 * 未登录或读不到列表时退回默认收藏夹（不拦住收藏这个动作）。
 */
export function FavPicker({
  open,
  busy,
  onClose,
  onPick,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onPick: (folderId: number | null) => void
}) {
  const [folders, setFolders] = useState<FavFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setFolders(null)
    setError(null)
    void ipc
      .favFolders()
      .then((list) => {
        if (!cancelled) setFolders(list)
      })
      .catch((e) => {
        if (!cancelled) setError(toWireError(e).message)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Modal
      open={open}
      title="收藏到"
      description={null}
      onClose={onClose}
      width="max-w-[420px]"
    >
      {folders === null && !error ? (
        <p className="text-[13px] text-[var(--text-3)]">正在读取收藏夹…</p>
      ) : null}

      {error ? (
        <div className="rounded-[6px] bg-[var(--panel-raised)] px-3 py-2 text-[13px] text-[var(--text-2)]">
          读不到收藏夹（{error}）。<br />
          收藏会放进默认收藏夹。
        </div>
      ) : null}

      <div className="mt-2 max-h-[280px] space-y-1 overflow-y-auto">
        {(folders ?? []).map((folder) => (
          <button
            key={folder.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(folder.id)}
            className="flex w-full items-center justify-between gap-3 rounded-[6px] border border-[var(--line)] px-3 py-2 text-left hover:border-[var(--accent)] disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-[var(--text-1)]">{folder.title}</span>
              <span className="num block text-[11.5px] text-[var(--text-3)]">{folder.count} 个视频</span>
            </span>
            <Icon name="chevronRight" size={13} className="shrink-0 text-[var(--text-3)]" />
          </button>
        ))}
      </div>

      {/* 列表读得到时默认夹就在第一行，这颗按钮只在读不到时当兜底，免得两个入口重复。 */}
      {busy ? (
        <p className="mt-3 text-center text-[13px] text-[var(--text-3)]">收藏中…</p>
      ) : error || (folders !== null && folders.length === 0) ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-3 py-2 text-[14px] text-white"
        >
          收进默认收藏夹
        </button>
      ) : null}
    </Modal>
  )
}
