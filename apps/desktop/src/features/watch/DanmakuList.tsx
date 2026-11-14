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
    <div className="px-2 pb-2">
      {/* B 站把弹幕列表做成一条灰底圆角卡片，收起时只剩这条标题。 */}
      <div className="overflow-hidden rounded-[8px] border border-[var(--line)]">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="t flex h-9 w-full items-center gap-2 bg-[var(--ga0)] px-3 text-[13px] text-[var(--text-1)] hover:text-[var(--accent)]"
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
          <ul className="max-h-[240px] overflow-y-auto bg-[var(--panel)] px-1 py-1">
            {sorted.map((item, index) => (
              <li key={`${item.at}-${index}`}>
                <button
                  type="button"
                  onClick={() => {
                    void ipc.playerSeek(item.at).catch(() => {})
                  }}
                  title={item.text}
                  className="t flex w-full gap-2 rounded-[3px] px-2 py-0.5 text-left text-[12px] hover:bg-[var(--panel-hover)]"
                >
                  <span className="num shrink-0 text-[var(--text-3)]">{formatTime(item.at)}</span>
                  {/* B 站列表照抄弹幕自己的颜色：一眼能看出哪些是彩蛋、哪些是白字。
                      白字（含浅色）留在主题色上，否则会在白底列表里消失。 */}
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={isPale(item.color) ? undefined : { color: item.color }}
                  >
                    {item.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
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
