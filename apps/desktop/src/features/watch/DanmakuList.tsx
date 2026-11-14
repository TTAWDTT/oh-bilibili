import { useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { formatTime } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'
import type { DanmakuItem } from '../player/DanmakuField'

/**
 * 右栏的弹幕列表，B 站网页版默认收起。
 * 点一条就跳到那个时刻——比在进度条上盲找准。
 */
export function DanmakuList({ items }: { items: DanmakuItem[] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null

  const sorted = [...items].sort((a, b) => a.at - b.at)

  return (
    <div className="border-b border-hairline px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="t flex h-6 w-full items-center gap-2 text-[13px] text-[var(--text-1)] hover:text-[var(--accent)]"
      >
        <span className="min-w-0 flex-1 text-left">弹幕列表</span>
        <span className="num text-[11px] text-[var(--text-3)]">{items.length} 条</span>
        <Icon
          name="chevronRight"
          size={14}
          className={`shrink-0 text-[var(--text-3)] transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open ? (
        <ul className="mt-1 max-h-[240px] overflow-y-auto">
          {sorted.map((item, index) => (
            <li key={`${item.at}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  void ipc.playerSeek(item.at).catch(() => {})
                }}
                title={item.text}
                className="t flex w-full gap-2 rounded-[3px] px-1 py-0.5 text-left text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--accent)]"
              >
                <span className="num shrink-0 text-[var(--text-3)]">{formatTime(item.at)}</span>
                <span className="min-w-0 flex-1 truncate">{item.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
