import { useEffect, useRef, useState } from 'react'
import type { LyricDoc, LyricLine, Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { clamp } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Skeleton } from '../../shared/ui/Skeleton'
import { toastFailure } from '../../app/notice'
import { useAppStore } from '../../app/appStore'
import { usePlayerStore } from './playerStore'
import { useSmoothIndex } from '../../shared/lib/useSmoothIndex'

function ActiveLine({ line, nextAt }: { line: LyricLine; nextAt: number }) {
  const fillRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let frame = 0
    const paint = (): void => {
      const end = Math.max(nextAt, line.at_ms + 800)
      const progress = clamp((readPlayhead() - line.at_ms) / (end - line.at_ms), 0, 1)
      const node = fillRef.current
      if (node) node.style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [line.at_ms, nextAt])

  return (
    <span className="relative block">
      <span className="text-[var(--text-2)]">{line.text}</span>
      <span
        ref={fillRef}
        aria-hidden
        className="absolute inset-0 block"
        style={{
          backgroundImage: 'linear-gradient(96deg, #ffffff 8%, var(--accent) 92%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        {line.text}
      </span>
    </span>
  )
}

const EMPTY_TIMES: number[] = []

export function LyricsView({ track }: { track: Track | null }) {
  const seek = usePlayerStore((state) => state.seek)
  const navigate = useAppStore((state) => state.navigate)
  const toggleRail = useAppStore((state) => state.toggleRail)
  const [doc, setDoc] = useState<LyricDoc | null>(null)
  const [loading, setLoading] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<Array<HTMLDivElement | null>>([])
  const [offset, setOffset] = useState(0)
  const key = track?.key ?? null

  useEffect(() => {
    if (!key) {
      setDoc(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setDoc(null)
    ipc
      .lyricsGet(key)
      .then((next) => {
        if (cancelled) return
        setDoc(next)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setLoading(false)
        setDoc(null)
        toastFailure('读取歌词', cause)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  const lineTimes = doc && doc.synced ? doc.lines.map((l) => l.at_ms) : EMPTY_TIMES
  const active = useSmoothIndex(lineTimes, Boolean(doc && doc.synced))

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let frame = 0
    // 量在帧回调里做：既不与 React 提交同帧布局，也能合并 ResizeObserver 的连续触发。
    const recalc = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const line = lineRefs.current[active]
        if (!line) {
          setOffset(0)
          return
        }
        setOffset(scroller.clientHeight * 0.42 - line.offsetTop - line.offsetHeight / 2)
      })
    }
    recalc()
    const observer = new ResizeObserver(recalc)
    observer.observe(scroller)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [active, doc])

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 px-7 py-10" aria-hidden>
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className={index % 2 === 0 ? 'h-3.5 w-4/5' : 'h-3.5 w-3/5'} />
        ))}
      </div>
    )
  }

  if (!doc || doc.lines.length === 0) {
    return (
      <EmptyState
        icon="biliTv"
        title={track ? '这条视频没挂歌词，先听个响' : '还没有在播放'}
        detail={track ? '三级回退都没查到时不去编造，播放本身不受影响。' : '挑一首歌，歌词会跟着进度滚动。'}
        action={track ? { label: '看看队列', onClick: () => toggleRail('queue') } : { label: '去搜索', onClick: () => navigate({ kind: 'search' }) }}
        compact
      />
    )
  }

  if (!doc.synced) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="px-5 pb-2 pt-4 text-[12px] tracking-[0.14em] text-[var(--text-2)]">纯文本 · {doc.source}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
          {doc.lines.map((line, index) => (
            <p key={index} className="py-2 text-[14px] leading-relaxed text-[var(--text-2)]">
              {line.text}
            </p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-5 pb-1 pt-4 text-[12px] tracking-[0.14em] text-[var(--text-2)]">
        <span>歌词</span>
        <span>{doc.source}</span>
      </div>
      <div ref={scrollerRef} className="lyrics-mask min-h-0 flex-1 overflow-hidden px-5">
        <div
          className="t relative aspect-square"
          style={{ transform: `translateY(${offset}px)` }}
        >
          {doc.lines.map((line, index) => {
            const next = doc.lines[index + 1]
            const nextAt = next ? next.at_ms : line.at_ms + 4000
            const isActive = index === active
            return (
              <div
                key={`${line.at_ms}-${index}`}
                ref={(node) => {
                  lineRefs.current[index] = node
                }}
                className={isActive ? 'py-3' : 'py-2'}
              >
                <button type="button" onClick={() => void seek(line.at_ms)} data-row="lyric"
                    className="t w-full text-center" tabIndex={-1}>
                  {isActive ? (
                    <span className="block text-[22px] font-medium leading-[1.5] tracking-[-0.01em] text-[var(--text-1)]">
                      <ActiveLine line={line} nextAt={nextAt} />
                    </span>
                  ) : (
                    <span className="t block text-[14px] leading-[1.6] text-[var(--text-3)] hover:text-[var(--text-2)]">
                      {line.text}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
