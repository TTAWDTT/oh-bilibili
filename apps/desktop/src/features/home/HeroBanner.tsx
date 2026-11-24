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
      className="bili-hero-swap relative min-w-0 overflow-hidden sm:max-lg:grid sm:max-lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:max-lg:items-center rounded-[10px] border border-[var(--line)] bg-[var(--panel)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={(event) => setPaused(event.currentTarget.matches(':focus-within'))}
      onFocus={() => setPaused(true)}
      onBlur={(event) => setPaused(event.currentTarget.contains(event.relatedTarget) || event.currentTarget.matches(':hover'))}
    >
      <div className="relative">
        <span className="relative block aspect-video overflow-hidden bg-[var(--ga1)]">
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
              className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none"
              style={{ opacity: i === index ? 1 : 0 }}
            />
          ))}
          {current.duration_ms != null && current.duration_ms > 0 && (
            <span className="num absolute bottom-2.5 right-3 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[12px] text-white">
              {formatDuration(current.duration_ms)}
            </span>
          )}
        </span>
        {slides.length > 1 && (
          <div className="absolute left-3 top-2.5 z-10 flex items-center rounded-full bg-black/65 px-1 text-white">
            <button type="button" aria-label="上一张推荐"
              onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
              className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/20">
              <Icon name="chevronLeft" size={14} />
            </button>
            {slides.map((track, i) => (
              <button type="button" key={track.key} aria-label={`第 ${i + 1} 张推荐`} aria-current={i === index}
                onClick={() => setIndex(i)}
                className="group grid h-7 w-4 place-items-center rounded">
                <span className={i === index ? 'h-1.5 w-3 rounded-full bg-white' : 'h-1.5 w-1.5 rounded-full bg-white/60 group-hover:bg-white'} />
              </button>
            ))}
            <button type="button" aria-label="下一张推荐" onClick={() => setIndex((i) => (i + 1) % slides.length)}
              className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/20">
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="min-w-0 px-3.5 py-3">
        <h3 className="text-[17px] font-semibold leading-[1.4] text-[var(--text-1)]">
          <button
            type="button"
            onClick={() => onOpen(current)}
            data-focus-id={`hero:${current.key}`}
            aria-label={`观看 ${current.title}`}
            className="block w-full text-left after:absolute after:inset-0 hover:text-[var(--accent-strong)]"
          >
            <span className="line-clamp-2">{current.title}</span>
          </button>
        </h3>
        <div className="relative mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-2)]">
          {current.artist && <TrackByline track={current} focusId={`hero-author:${current.key}`} />}
          {current.views != null && (
            <span className="num inline-flex items-center gap-1" aria-label={`${formatCount(current.views)} 播放`}>
              <Icon name="play" size={12} />{formatCount(current.views)}
            </span>
          )}
          {current.danmaku != null && (
            <span className="num inline-flex items-center gap-1" aria-label={`${formatCount(current.danmaku)} 条弹幕`}>
              <Icon name="danmaku" size={13} />{formatCount(current.danmaku)}
            </span>
          )}
        </div>
        <div className="relative">
          <TrackDirectory key={current.key} track={current} sourceId={`hero:${current.key}`} />
        </div>
        {quote && (
          <HeroQuoteLine track={current} quote={quote} featured onOpen={onOpen} />
        )}
      </div>
    </section>
  )
}
