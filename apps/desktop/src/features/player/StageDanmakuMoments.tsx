import { useMemo } from 'react'
import { formatCount, formatTime } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'
import type { DanmakuItem } from './danmakuMerge'
import { usePlayerStore } from './playerStore'

const WINDOW_MS = 12_000

type Moment = { line: DanmakuItem; from: number; count: number }

export function StageDanmakuMoments({
  items,
  onSeek,
}: {
  items: DanmakuItem[]
  onSeek: (at: number) => void
}) {
  const duration = usePlayerStore((s) => s.progress.duration_ms)
  const moments = useMemo(() => pickMoments(items, duration), [items, duration])

  const active = usePlayerStore((s) => moments.find(({ from }) => {
    const elapsed = s.progress.position_ms - from
    return elapsed >= 0 && elapsed < WINDOW_MS
  }))

  if (!moments.length) {
    return <p className="grid h-full place-items-center text-[14px] text-[var(--text-2)]">暂无匹配歌词</p>
  }

  return (
    <section aria-label="弹幕听点" className="mx-auto flex h-full max-w-[540px] flex-col justify-center px-1 sm:px-4">
      <h3 className="mb-2 flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-2 pb-2 text-[15px] font-semibold text-[var(--text-1)]">
        <Icon name="danmaku" size={18} />
        弹幕听点
      </h3>
      <ol className="min-h-0 overflow-y-auto">
        {moments.map(({ line, from, count }) => {
          const current = active?.line === line
          return (
            <li key={line.at}>
              <button
                type="button"
                aria-current={current ? 'time' : undefined}
                aria-label={`跳到 ${formatTime(line.at)}，${line.text}`}
                onClick={() => onSeek(line.at)}
                className="group t flex min-h-12 w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left hover:bg-[var(--panel)]/65 focus-visible:bg-[var(--panel)]/65 sm:gap-4"
              >
                <span className={`num flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-mono text-[12px] ${current ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]' : 'bg-[var(--panel)]/65 text-[var(--text-2)] group-hover:text-[var(--accent-strong)]'}`}>
                  <Icon name="play" size={12} />
                  {formatTime(line.at)}
                </span>
                <span title={line.text} className="line-clamp-2 min-w-0 flex-1 break-words text-[16px] leading-snug text-[var(--text-1)]">{line.text}</span>
                <span
                  title={`${formatTime(from)} 至 ${formatTime(Math.min(duration, from + WINDOW_MS))} 的弹幕数`}
                  className="num shrink-0 text-[12px] text-[var(--text-3)]"
                >
                  {formatCount(count)} 条
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function pickMoments(items: DanmakuItem[], duration: number): Moment[] {
  const lines = items
    .filter((item) => item.at >= 0 && item.at < duration && item.text.trim())
    .sort((a, b) => a.at - b.at)
  const readable = lines.flatMap((line, index) =>
    /^(?:\p{Nd}|[\p{P}\s]+)$/u.test(line.text.trim()) ? [] : [index],
  )
  if (!readable.length) return []

  const windows: Moment[] = []
  let end = 0
  let nearest = 0
  for (const [start, { at: from }] of lines.entries()) {
    while (end < lines.length && lines[end]!.at < from + WINDOW_MS) end += 1
    const middle = (start + end - 1) / 2
    while (nearest + 1 < readable.length &&
      Math.abs(readable[nearest + 1]! - middle) <= Math.abs(readable[nearest]! - middle)) {
      nearest += 1
    }
    const index = readable[nearest]!
    if (index >= start && index < end) windows.push({ from, count: end - start, line: lines[index]! })
  }

  const moments: Moment[] = []
  const spacing = Math.max(WINDOW_MS, duration / 12)
  for (const window of windows.sort((a, b) => b.count - a.count)) {
    const overlaps = moments.some(({ from, line }) =>
      Math.abs(from - window.from) < WINDOW_MS || Math.abs(line.at - window.line.at) < spacing,
    )
    if (overlaps) continue
    moments.push(window)
    if (moments.length === 4) break
  }
  return moments.sort((a, b) => a.line.at - b.line.at)
}
