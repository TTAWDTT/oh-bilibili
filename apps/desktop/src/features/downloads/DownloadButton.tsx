import type { MouseEvent } from 'react'
import { useDownloadsStore } from '../downloads/downloadsStore'
import { Icon } from '../../shared/ui/Icon'

type DownloadButtonProps = {
  trackKey: string
  size?: number
  /** 卡片封面上的图标按钮，或「更多」菜单里带文字的一行。 */
  variant?: 'icon' | 'menu'
  /** 菜单里点完要收起。 */
  onInvoke?: () => void
}

export function DownloadButton({ trackKey, size = 16, variant = 'icon', onInvoke }: DownloadButtonProps) {
  const item = useDownloadsStore((state) => (state.items ?? []).find((entry) => entry.key === trackKey) ?? null)
  const enqueue = useDownloadsStore((state) => state.enqueue)
  const busy = item?.state === 'queued' || item?.state === 'running'
  const done = item?.state === 'done'
  const label = done ? '已下载' : busy ? '下载中' : '下载'

  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (busy || done) return
    onInvoke?.()
    void enqueue(trackKey)
  }

  if (variant === 'menu') {
    return (
      <button
        type="button"
        role="menuitem"
        aria-label={label}
        disabled={busy || done}
        onClick={onClick}
        className="ui-audit-ok flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-white/85 hover:bg-white/10 disabled:cursor-default disabled:opacity-60"
      >
        <Icon
          name={done ? 'check' : busy ? 'clock' : 'download'}
          size={size}
          className={done ? 'text-[var(--ok)]' : busy ? 'text-[var(--accent)]' : 'ui-audit-ok text-white/70'}
        />
        <span>{label}</span>
      </button>
    )
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
          ? 'text-[var(--ok)]'
          : busy
            ? 'text-[var(--accent)]'
            : 'text-[var(--text-2)] hover:text-[var(--text-1)]',
      ].join(' ')}
    >
      <Icon name={done ? 'check' : busy ? 'clock' : 'download'} size={size} />
    </button>
  )
}
