import { useEffect, useRef } from 'react'
import type { PageRef } from '../../shared/lib/contract'
import { formatTime } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'

/**
 * 多 P 视频的「视频选集」。B 站把它做成右栏一张带集数的卡片：
 * 每一行是 P 序号 + 标题 + 时长，当前 P 高亮，长列表自己滚。
 *
 * 分 P 接口不给每 P 的封面，所以这里不硬塞同一张主封面当缩略图。
 */
export function PageList({
  pages,
  current,
  onPage,
}: {
  pages: PageRef[]
  current: number
  onPage: (no: number) => void
}) {
  const currentRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  if (pages.length <= 1) return null

  return (
    <div className="px-2 pb-2">
      <div className="overflow-hidden rounded-[8px] border border-[var(--line)]">
        <div className="flex items-baseline gap-2 border-b border-hairline px-3 py-2">
          <h3 className="min-w-0 truncate text-[13px] font-medium text-[var(--text-1)]">视频选集</h3>
          <span className="num shrink-0 text-[11px] text-[var(--text-3)]">{pages.length} 集</span>
        </div>
        <ol className="flex max-h-[320px] flex-col gap-y-0.5 overflow-y-auto px-1.5 py-1.5">
          {pages.map((page) => {
            const active = page.no === current
            return (
              <li key={page.cid}>
                <button
                  ref={active ? currentRef : undefined}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPage(page.no)}
                  title={page.title}
                  className={`t flex w-full items-start gap-2 rounded-[4px] px-1.5 py-1 text-left ${
                    active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-alt)]'
                  }`}
                >
                  <span
                    className={`num w-7 shrink-0 pt-0.5 text-center text-[11px] ${
                      active ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'
                    }`}
                  >
                    P{page.no}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`line-clamp-2 text-[12px] leading-[1.4] ${
                        active ? 'text-[var(--accent)]' : 'text-[var(--text-1)]'
                      }`}
                    >
                      {page.title || `第 ${page.no} P`}
                    </span>
                    {page.duration_ms ? (
                      <span className="num mt-0.5 block text-[11px] text-[var(--text-3)]">
                        {formatTime(page.duration_ms)}
                      </span>
                    ) : null}
                  </span>
                  {active ? <Icon name="play" size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" /> : null}
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
