import { useEffect, useRef, useState } from 'react'
import { StageDanmakuMoments } from './StageDanmakuMoments'
import type { DanmakuItem } from './danmakuMerge'
import type { LyricLine } from '../../shared/lib/contract'

type StageLyricsProps = {
  lines: readonly LyricLine[]
  danmaku: DanmakuItem[]
  synced: boolean
  active: number
  loading: boolean
  failed: string | null
  source: string
  trackKey: string
  onSeek: (atMs: number) => void
  onRetry: () => void
}

export function StageLyrics({
  lines,
  danmaku,
  synced,
  active,
  loading,
  failed,
  source,
  trackKey,
  onSeek,
  onRetry,
}: StageLyricsProps) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const rows = useRef<Array<HTMLButtonElement | null>>([])
  const [following, setFollowing] = useState(true)

  useEffect(() => {
    setFollowing(true)
    if (scroller.current) scroller.current.scrollTop = 0
  }, [trackKey])

  const followActive = (): void => {
    const root = scroller.current
    const row = rows.current[active]
    if (!root || !row) return
    root.scrollTo({
      top: row.offsetTop - root.clientHeight * 0.38 + row.offsetHeight / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  useEffect(() => {
    if (following && synced) followActive()
  }, [active, following, synced])

  if (loading) {
    return <div className="grid min-h-[220px] place-items-center text-[14px] text-[var(--text-2)]">正在取歌词…</div>
  }

  if (failed) {
    return (
      <div className="grid min-h-[220px] place-items-center">
        <button
          type="button"
          onClick={onRetry}
          className="t press rounded-[6px] border border-[var(--line)] px-4 py-2 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          {failed}，重新取一次
        </button>
      </div>
    )
  }

  if (lines.length === 0) {
    return <StageDanmakuMoments items={danmaku} onSeek={onSeek} />
  }

  const resumeFollowing = (): void => {
    scroller.current?.focus({ preventScroll: true })
    setFollowing(true)
  }

  return (
    <div data-stage-lyrics className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex h-8 shrink-0 items-center justify-between gap-3 px-2 text-[12px] text-[var(--text-3)]">
        <span>{source === 'bilibili-subtitle' ? '视频字幕' : synced ? '同步歌词' : '歌词'}</span>
        {!following && synced ? (
          <button
            type="button"
            onClick={resumeFollowing}
            className="t press rounded-full bg-[var(--panel)]/80 px-3 py-1 text-[12px] text-[var(--text-1)] shadow-sm hover:text-[var(--accent-strong)]"
          >
            回到当前句
          </button>
        ) : null}
      </div>
      <div
        ref={scroller}
        data-stage-lyric-scroll
        tabIndex={0}
        onWheel={() => setFollowing(false)}
        onKeyDown={(event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            setFollowing(false)
            const root = scroller.current
            if (!root) return
            if (event.key === 'Home') root.scrollTo({ top: 0 })
            else if (event.key === 'End') root.scrollTo({ top: root.scrollHeight })
            else {
              const step =
                event.key === 'PageUp' || event.key === 'PageDown'
                  ? root.clientHeight * 0.8
                  : 56
              root.scrollBy({ top: event.key === 'ArrowUp' || event.key === 'PageUp' ? -step : step })
            }
          }
        }}
        className="no-scrollbar lyrics-mask relative min-h-0 flex-1 overflow-y-auto px-3 pb-16 pt-12 outline-none"
      >
        {lines.map((line, index) => {
          if (!line.text.trim()) return null
          if (!synced) {
            return <p key={index} className="px-3 py-1.5 text-[16px] leading-[1.55] text-[var(--text-2)]">{line.text}</p>
          }
          const current = index === active
          return (
            <button
              key={`${line.at_ms}-${index}`}
              type="button"
              data-current={current ? 'true' : undefined}
              ref={(node) => {
                rows.current[index] = node
              }}
              onClick={() => {
                onSeek(line.at_ms)
                setFollowing(true)
              }}
              className={[
                't block min-h-9 w-full rounded-[6px] px-3 py-1.5 text-left leading-[1.55]',
                current
                  ? 'text-[24px] font-semibold text-[var(--text-1)]'
                  : 'text-[16px] text-[var(--text-3)] hover:bg-[var(--panel)]/55 hover:text-[var(--text-2)]',
              ].join(' ')}
            >
              {line.text}
            </button>
          )
        })}
      </div>
    </div>
  )
}
