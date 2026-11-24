import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { DanmakuItem } from './DanmakuField'
import { formatTime } from '../../shared/lib/format'
import './danmaku-beats.css'

const BUCKETS = 120
const MIN_BAR_PX = 2
const MAX_BAR_PX = 8
const SAMPLES = 3

type Bucket = {
  start: number
  end: number
  count: number
  /** 这一段的真实弹幕：按时间排序、同文本去重，最多三条。 */
  samples: DanmakuItem[]
}

/**
 * 柱高按 sqrt(count/max) 压：热门片段常比普通片段多一个数量级，
 * 线性映射下其余柱子会全贴底，看不出分布。
 */
export function DanmakuBeats({
  items,
  durationMs,
  enabled = true,
  resetKey,
  onSeek,
}: {
  items: DanmakuItem[]
  durationMs: number
  /** 弹幕关掉时热度仍可看，但不再给预览，也不再是 Tab 停靠点。 */
  enabled?: boolean
  /** 换分 P 时清掉旧预览；同一份数据重渲染不会误关。 */
  resetKey?: string | number
  /** 只有预览卡片里的播放按钮会调用它；点热度本身不定位。 */
  onSeek?: ((atMs: number) => void) | undefined
}) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const [pinned, setPinned] = useState(false)
  const [hoverTarget, setHoverTarget] = useState<number | null>(null)

  const bars = useMemo(() => {
    if (durationMs <= 0 || items.length === 0) return null
    const bucketMs = durationMs / BUCKETS
    const list: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
      start: i * bucketMs,
      end: (i + 1) * bucketMs,
      count: 0,
      samples: [],
    }))
    for (const item of items) {
      const index = Math.min(BUCKETS - 1, Math.max(0, Math.floor((item.at / durationMs) * BUCKETS)))
      const bucket = list[index]!
      bucket.count += 1
      if (bucket.samples.length < SAMPLES) bucket.samples.push(item)
    }
    for (const bucket of list) {
      if (bucket.samples.length === 0) continue
      const seen = new Set<string>()
      bucket.samples = bucket.samples
        .slice()
        .sort((a, b) => a.at - b.at)
        .filter((item) => {
          if (seen.has(item.text)) return false
          seen.add(item.text)
          return true
        })
        .slice(0, SAMPLES)
    }
    const max = list.reduce((peak, bucket) => Math.max(peak, bucket.count), 0)
    if (max === 0) return null
    return list.map((bucket) => {
      if (bucket.count === 0) {
        return { ...bucket, height: 0, opacity: 0 }
      }
      const ratio = Math.sqrt(bucket.count / max)
      return {
        ...bucket,
        height: MIN_BAR_PX + (MAX_BAR_PX - MIN_BAR_PX) * ratio,
        opacity: 0.2 + 0.28 * ratio,
      }
    })
  }, [items, durationMs])

  // 斜向移入卡片时会经过相邻的柱子；仅在新时段停留后切换预览。
  useEffect(() => {
    if (hoverTarget === null || pinned || !enabled) return
    const timer = window.setTimeout(() => setActive(bars?.[hoverTarget]?.count ? hoverTarget : null), 150)
    return () => window.clearTimeout(timer)
  }, [bars, enabled, hoverTarget, pinned])

  // 换 P、关弹幕、或过滤后这一段没有样本时，旧预览不能留在画面上。
  useEffect(() => {
    setActive(null)
    setPinned(false)
    setHoverTarget(null)
  }, [resetKey])

  useEffect(() => {
    if (!enabled) {
      setActive(null)
      setPinned(false)
      return
    }
    if (active !== null && !bars?.[active]?.samples.length) setActive(null)
  }, [active, bars, enabled])

  useEffect(() => {
    if (!pinned) return
    const onDown = (event: PointerEvent): void => {
      if (stripRef.current?.contains(event.target as Node)) return
      setActive(null)
      setPinned(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [pinned])

  if (!bars) return null

  const interactive = enabled && typeof onSeek === 'function'
  const bucketAt = (clientX: number): number | null => {
    const box = stripRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    return Math.min(BUCKETS - 1, Math.floor(ratio * BUCKETS))
  }
  const firstFilled = bars.findIndex((bar) => bar.count > 0)
  const shown = active !== null ? bars[active] : undefined
  const startLabel = shown && formatTime(shown.start)
  const endLabel = shown && formatTime(shown.end)
  const close = (): void => {
    setActive(null)
    setPinned(false)
    stripRef.current?.focus()
  }

  return (
    <div
      ref={stripRef}
      role="group"
      aria-label="弹幕热度，悬停查看该段弹幕，左右键选择有弹幕的时段"
      tabIndex={interactive ? 0 : -1}
      data-danmaku-beats
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onPointerMove={(event) => {
        // 下方进度条用 pointerup 定位、pointermove 出缩略图；热度条的按下/松开/移动
        // 都不能漏给它，否则读一条弹幕就把播放位置带走了。
        event.stopPropagation()
        if (!interactive || pinned) return
        const target = event.target as HTMLElement
        if (target.closest('[data-danmaku-preview]')) return
        // 窄窗的一根柱可能不到两个像素，取整的指针坐标会落进隔壁时段。
        const index = target.dataset.bucket === undefined ? bucketAt(event.clientX) : Number(target.dataset.bucket)
        if (index === null) return
        if (active === null && bars[index]?.count) setActive(index)
        setHoverTarget(active !== null && index !== active ? index : null)
      }}
      onPointerLeave={() => {
        setHoverTarget(null)
        if (!pinned) setActive(null)
      }}
      onFocus={() => {
        if (!interactive || active !== null || firstFilled < 0) return
        setActive(firstFilled)
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setActive(null)
        setPinned(false)
      }}
      onKeyDown={(event) => {
        if (!interactive) return
        setHoverTarget(null)
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
          return
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          const step = event.key === 'ArrowRight' ? 1 : -1
          let index = active ?? firstFilled
          do {
            index += step
          } while (index >= 0 && index < BUCKETS && bars[index]!.count === 0)
          if (index < 0 || index >= BUCKETS) return
          setActive(index)
          return
        }
        if ((event.key === 'Enter' || event.key === ' ') && active === null) {
          event.preventDefault()
          if (firstFilled >= 0) setActive(firstFilled)
        }
      }}
      className={`absolute inset-x-0 top-0 h-2 ${
        interactive ? 'cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]' : 'pointer-events-none'
      }`}
    >
      <span className="sr-only">弹幕热度</span>
      <div aria-hidden className="flex h-full items-end gap-px">
        {bars.map((bar, i) => (
          <span
            key={i}
            data-bucket={i}
            onClick={
              interactive && bar.count > 0
                ? (event) => {
                    event.stopPropagation()
                    // 固定预览后焦点留在热度条上，Esc 才有落点。
                    stripRef.current?.focus()
                    setHoverTarget(null)
                    setActive(i)
                    setPinned(true)
                  }
                : undefined
            }
            className="flex-1 rounded-[1px]"
            style={{
              height: bar.height,
              background: interactive && i === active ? 'var(--accent)' : `rgb(255 255 255 / ${bar.opacity})`,
            }}
          />
        ))}
      </div>
      {shown && shown.samples.length > 0 ? (
        <div
          data-danmaku-preview
          onPointerEnter={() => setHoverTarget(null)}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          /* ui-audit-ok: 预览气泡固定深底，描边和时间都叠在这块底色上。 */
          className="watch-beat-preview absolute bottom-full z-40 rounded-lg border border-white/15 bg-[#202226] px-3 py-2 text-white shadow-lg"
          style={{ '--beat-at': `${((active ?? 0) + 0.5) * (100 / BUCKETS)}%` } as CSSProperties}
        >
          {startLabel !== endLabel && (
            <div className="num mb-1.5 text-[11px] text-slate-300">
              {startLabel} – {endLabel}
            </div>
          )}
          <div className="flex flex-col gap-1">
            {shown.samples.map((line, i) => (
              <span
                key={`${line.text}-${i}`}
                className="truncate text-[12px] leading-5"
                style={{ color: line.color }}
              >
                {line.text}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSeek?.(shown.samples[0]!.at)
              setActive(null)
              setPinned(false)
              stripRef.current?.focus()
            }}
            className="t press mt-2 flex h-7 w-full items-center justify-center rounded-[4px] bg-white/10 text-[12px] font-medium text-white hover:bg-white/20"
          >
            从 {formatTime(shown.samples[0]!.at)} 播放
          </button>
        </div>
      ) : null}
    </div>
  )
}
