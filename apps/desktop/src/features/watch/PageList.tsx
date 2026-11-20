import { useEffect, useRef } from 'react'
import type { PageRef } from '../../shared/lib/contract'
import { formatTime } from '../../shared/lib/format'
import { usePlayerStore } from '../player/playerStore'
import { scrollIntoList } from './listScroll'

/** 正在播的那一集进度会一直往前走：只让这一行订阅播放进度，别把整张表带上。 */
function LivePageBar({ durationMs }: { durationMs: number }) {
  const at = usePlayerStore((state) => state.progress.position_ms)
  const ratio = durationMs > 0 ? Math.min(1, at / durationMs) : 0
  if (ratio <= 0) return null
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0.5 left-8 right-2 h-[2px] overflow-hidden rounded-full bg-[var(--line)]"
    >
      <span
        className="block h-full rounded-full bg-[var(--accent)]"
        style={{ width: `${ratio * 100}%` }}
      />
    </span>
  )
}

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
  progress,
}: {
  pages: PageRef[]
  current: number
  onPage: (no: number) => void
  /** P 序号 → 已看到的毫秒数。没有记录的不画。 */
  progress?: Record<number, number>
}) {
  const currentRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    scrollIntoList(currentRef.current, listRef.current)
  }, [current])

  if (pages.length <= 1) return null

  return (
    <div className="px-2 pb-2">
      <div className="overflow-hidden rounded-[8px] border border-[var(--line)]">
        <div className="flex items-baseline gap-2 border-b border-hairline px-3 py-2">
          <h3 className="min-w-0 truncate text-[13px] font-medium text-[var(--text-1)]">视频选集</h3>
          <span className="num shrink-0 text-[11px] text-[var(--text-3)]">
            ({current}/{pages.length})
          </span>
        </div>
        <ol ref={listRef} className="flex max-h-[320px] flex-col overflow-y-auto px-1.5 py-1.5">
          {pages.map((page) => {
            const active = page.no === current
            const seen = progress?.[page.no] ?? 0
            const ratio = page.duration_ms > 0 ? Math.min(1, seen / page.duration_ms) : 0
            return (
              <li key={page.cid}>
                <button
                  ref={active ? currentRef : undefined}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPage(page.no)}
                  title={page.title}
                  className={`t relative flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left ${
                    active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-alt)]'
                  }`}
                >
                  {active ? (
                    <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-[var(--accent)]" />
                  ) : null}
                  <span
                    className={`num w-6 shrink-0 text-[11px] ${
                      active ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'
                    }`}
                  >
                    P{page.no}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[12px] ${
                      active ? 'text-[var(--accent)]' : 'text-[var(--text-1)]'
                    }`}
                  >
                    {page.title || `第 ${page.no} P`}
                  </span>
                  {page.duration_ms ? (
                    <span className="num shrink-0 text-[11px] text-[var(--text-3)]">
                      {formatTime(page.duration_ms)}
                    </span>
                  ) : null}
                  {active ? (
                    <LivePageBar durationMs={page.duration_ms} />
                  ) : ratio > 0 ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute bottom-0.5 left-8 right-2 h-[2px] overflow-hidden rounded-full bg-[var(--line)]"
                    >
                      <span
                        className="block h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
