import { useMemo, useState } from 'react'
import { VirtualList } from '../../shared/ui/VirtualList'
import { formatTime } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'
import type { DanmakuItem } from '../player/DanmakuField'

const ROW_HEIGHT = 30

export function DanmakuList({ items, onSeek }: { items: DanmakuItem[]; onSeek: (ms: number) => void }) {
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() => open ? [...items].sort((a, b) => a.at - b.at) : [], [items, open])
  if (items.length === 0) return null

  return (
    <section className="watch-dm-directory">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="watch-dm-heading"
      >
        <span className="flex-1 text-left">弹幕列表</span>
        <span className="num text-xs font-normal text-[var(--text-3)]">{items.length} 条</span>
        <Icon name="chevronRight" size={14} className={open ? '-rotate-90' : 'rotate-90'} />
      </button>
      {open && (
        <div
          role="region"
          aria-label="按时间排列的弹幕"
          className="flex flex-col"
          style={{ height: Math.min(8, sorted.length) * ROW_HEIGHT }}
        >
          <VirtualList
            items={sorted}
            rowHeight={ROW_HEIGHT}
            renderRow={(item) => (
              <button type="button" onClick={() => onSeek(item.at)} title={item.text} className="watch-dm-row">
                <span className="num text-[var(--text-3)]">{formatTime(item.at)}</span>
                <span className="truncate" style={isPale(item.color) ? undefined : { color: item.color }}>
                  {item.text}
                </span>
              </button>
            )}
          />
        </div>
      )}
    </section>
  )
}

/** 判断一条弹幕的颜色在白底上会不会读不出来。阈值取 0.86，纯白和淡黄都会落到这一侧。 */
function isPale(hex: string): boolean {
  const nudge = hex.replace('#', '')
  if (nudge.length !== 6) return true
  const r = parseInt(nudge.slice(0, 2), 16) / 255
  const g = parseInt(nudge.slice(2, 4), 16) / 255
  const b = parseInt(nudge.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.86
}
