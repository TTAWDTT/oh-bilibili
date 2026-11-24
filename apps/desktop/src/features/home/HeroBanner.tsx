import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { thumbWide } from '../../shared/lib/thumb'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { TrackByline } from '../tracks/TrackByline'
import { Icon } from '../../shared/ui/Icon'
import { TrackDirectory } from '../tracks/TrackDirectory'
import { HeroQuoteLine, useHeroQuote } from './HeroQuote'

const SLIDE_MS = 6000
const FALLBACK_COVER = '/assets/cover-fallback.jpg'

/** 按会话记住轮播停在哪一张：从视频返回时回到原来那张，而不是第一张。 */
const carouselMemory: { first: string | null; index: number } = { first: null, index: 0 }

/**
 * 发现页顶部的轮播。
 * 条目来自推荐流，只有当前这一张会补取同分 P 的弹幕引文；鼠标停留或键盘聚焦时不再自动翻页。
 */
export function HeroBanner({
  tracks,
  onOpen,
}: {
  tracks: Track[]
  onOpen: (track: Track, start?: { page: number; atMs: number }) => void
}) {
  const slides = tracks.slice(0, 5)
  const [index, setIndex] = useState(() => {
    const remembered = carouselMemory.first === slides[0]?.key ? carouselMemory.index : 0
    return Math.min(remembered, Math.max(0, slides.length - 1))
  })
  const [paused, setPaused] = useState(false)

  // 换一批之后条目全变，从第一张重新开始；只是从别的页面回来则保留原来那张。
  const first = slides[0]?.key
  const previousFirst = useRef(first)
  useEffect(() => {
    if (previousFirst.current === first) return
    previousFirst.current = first
    setIndex(0)
  }, [first])

  useEffect(() => {
    carouselMemory.first = slides[0]?.key ?? null
    carouselMemory.index = index
  }, [index, slides])

  useEffect(() => {
    if (paused || slides.length < 2) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length)
    }, SLIDE_MS)
    return () => window.clearInterval(timer)
  }, [paused, slides.length, index, first])

  const activeKey = slides[Math.min(index, Math.max(0, slides.length - 1))]?.key
  const quote = useHeroQuote(activeKey)

  if (slides.length === 0) return null
  const current = slides[Math.min(index, slides.length - 1)]!

  return (
    <section
      key={first}
      aria-label="推荐轮播"
      className="bili-hero-swap min-w-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={(event) => setPaused(event.currentTarget.matches(':focus-within'))}
      onFocus={() => setPaused(true)}
      onBlur={(event) => setPaused(event.currentTarget.contains(event.relatedTarget) || event.currentTarget.matches(':hover'))}
    >
      <h3 className="m-0">
        <button
          type="button"
          data-focus-id={`hero:${current.key}`}
          aria-label={`观看 ${current.title}`}
          onClick={() => onOpen(current)}
          className="group block w-full rounded-lg text-left"
        >
          <span className="relative block aspect-video overflow-hidden rounded-lg bg-[var(--ga1)]">
            {slides.map((track, i) => (
              <img
                key={track.key}
                data-track-title={track.title}
                src={thumbWide(track.cover, 1200) ?? FALLBACK_COVER}
                onError={(event) => {
                  if (event.currentTarget.getAttribute('src') !== FALLBACK_COVER) event.currentTarget.src = FALLBACK_COVER
                }}
                alt=""
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-contain transition-opacity duration-300 motion-reduce:transition-none"
                style={{ opacity: i === index ? 1 : 0 }}
              />
            ))}
            <span className="num absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-t from-black/65 to-transparent px-2 pb-1 pt-3 text-[12px] font-normal leading-4 text-white">
              {current.views != null && (
                <span className="inline-flex items-center gap-1" aria-label={`${formatCount(current.views)} 播放`}>
                  <Icon name="play" size={13} />{formatCount(current.views)}
                </span>
              )}
              {current.danmaku != null && (
                <span className="inline-flex items-center gap-1" aria-label={`${formatCount(current.danmaku)} 条弹幕`}>
                  <Icon name="danmaku" size={13} />{formatCount(current.danmaku)}
                </span>
              )}
              {current.duration_ms != null && current.duration_ms > 0 && (
                <span className="ml-auto">{formatDuration(current.duration_ms)}</span>
              )}
            </span>
          </span>
          <span className="mt-2 line-clamp-2 text-[17px] font-semibold leading-[23px] text-[var(--text-1)] group-hover:text-[var(--accent-strong)]">
            {current.title}
          </span>
        </button>
      </h3>
      <div className="mt-1 flex min-h-6 min-w-0 items-center justify-between gap-3 text-[12px] text-[var(--text-3)]">
        {current.artist && <TrackByline track={current} focusId={`hero-author:${current.key}`} />}
        {slides.length > 1 && (
          <div role="group" aria-label="切换推荐" className="ml-auto flex shrink-0 items-center">
            <button type="button" aria-label="上一张推荐"
              onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
              className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--ga1)] hover:text-[var(--accent-strong)]">
              <Icon name="chevronLeft" size={14} />
            </button>
            {slides.map((track, i) => (
              <button type="button" key={track.key} aria-label={`第 ${i + 1} 张推荐`} aria-current={i === index}
                onClick={() => setIndex(i)}
                className="grid h-7 w-4 place-items-center rounded">
                <span className={i === index ? 'h-1.5 w-3 rounded-full bg-[var(--accent)]' : 'h-1.5 w-1.5 rounded-full bg-[var(--ga3)]'} />
              </button>
            ))}
            <button type="button" aria-label="下一张推荐"
              onClick={() => setIndex((i) => (i + 1) % slides.length)}
              className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--ga1)] hover:text-[var(--accent-strong)]">
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
        )}
      </div>
      <TrackDirectory key={current.key} track={current} sourceId={`hero:${current.key}`} />
      {quote && <HeroQuoteLine track={current} quote={quote} featured onOpen={onOpen} />}
    </section>
  )
}
