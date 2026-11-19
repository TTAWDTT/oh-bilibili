import { useEffect, useState } from 'react'
import type { Chapter } from '../../shared/lib/chapters'
import { chaptersFrom } from '../../shared/lib/chapters'
import { formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'

/**
 * 简介里的时间戳章节。B 站把它做成右栏一张卡片：时间 + 标题，
 * 当前这一章高亮，点任意一条跳到那一刻。
 */
export function ChapterList({
  desc,
  chapters: fromMeta,
  onSeek,
}: {
  desc: string
  chapters: Chapter[]
  onSeek: (ms: number) => void
}) {
  // UP 主设过章节就用它；没设过才退回简介里的时间戳。
  const chapters = fromMeta.length > 0 ? fromMeta : chaptersFrom(desc)
  const [at, setAt] = useState(0)

  useEffect(() => {
    if (chapters.length < 2) return
    const timer = window.setInterval(() => setAt(readPlayhead()), 1000)
    return () => window.clearInterval(timer)
  }, [chapters.length])

  if (chapters.length < 2) return null

  let active = -1
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.at <= at + 500) active = index
  }

  return (
    <div className="px-2 pb-2">
      <div className="overflow-hidden rounded-[8px] border border-[var(--line)]">
        <div className="flex items-baseline gap-2 border-b border-hairline px-3 py-2">
          <h3 className="min-w-0 truncate text-[13px] font-medium text-[var(--text-1)]">章节</h3>
          <span className="num shrink-0 text-[11px] text-[var(--text-3)]">{chapters.length} 节</span>
        </div>
        <ol className="max-h-[240px] overflow-y-auto py-1">
          {chapters.map((chapter, index) => {
            const on = index === active
            return (
              <li key={chapter.at}>
                <button
                  type="button"
                  onClick={() => onSeek(chapter.at)}
                  title={chapter.title}
                  className={`t flex w-full items-baseline gap-2 px-3 py-1 text-left ${
                    on ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-alt)]'
                  }`}
                >
                  <span
                    className={`num shrink-0 text-[11px] ${
                      on ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'
                    }`}
                  >
                    {formatTime(chapter.at)}
                  </span>
                  <span
                    className={`line-clamp-1 min-w-0 text-[12px] ${
                      on ? 'text-[var(--accent)]' : 'text-[var(--text-1)]'
                    }`}
                  >
                    {chapter.title || `第 ${index + 1} 节`}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
