import type { MouseEvent } from 'react'
import { useDownloadsStore } from '../downloads/downloadsStore'
import { Icon } from '../../shared/ui/Icon'

type DownloadButtonProps = {
  trackKey: string
  size?: number
}

export function DownloadButton({ trackKey, size = 16 }: DownloadButtonProps) {
  const item = useDownloadsStore((state) => (state.items ?? []).find((entry) => entry.key === trackKey) ?? null)
  const enqueue = useDownloadsStore((state) => state.enqueue)
  const busy = item?.state === 'queued' || item?.state === 'running'
  const done = item?.state === 'done'
  const label = done ? '已下载' : busy ? '下载中' : '下载'

  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (busy || done) return
    void enqueue(trackKey)
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        't press flex h-6 w-6 items-center justify-center rounded-[4px]',
        done
          ? 'text-[#7bf0a0]'
          : busy
            ? 'text-[var(--accent)]'
            : 'text-white/48 hover:text-white',
      ].join(' ')}
    >
      <Icon name={done ? 'check' : busy ? 'clock' : 'download'} size={size} />
    </button>
  )
}
