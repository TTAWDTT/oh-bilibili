import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { thumbWide } from '../../shared/lib/thumb'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'

const SLIDE_MS = 6000

/**
 * 发现页顶部的轮播。B 站首页第一屏就是一张大图，标题压在图上。
 * 只用推荐流里已有的条目，不额外请求；鼠标停在上面时不再自动翻页。
 */
export function HeroBanner({ tracks, onOpen }: { tracks: Track[]; onOpen: (track: Track) => void }) {
  const slides = tracks.filter((t) => t.cover).slice(0, 5)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  // 换一批之后条目全变，从第一张重新开始
  const first = slides[0]?.key
  useEffect(() => {
    setIndex(0)
  }, [first])

  useEffect(() => {
    if (paused || slides.length < 2) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length)
    }, SLIDE_MS)
    return () => window.clearInterval(timer)
  }, [paused, slides.length, index, first])

  if (slides.length === 0) return null
  const current = slides[Math.min(index, slides.length - 1)]!

  return (
    <section
      /* key 绑首条：换一换之后整块重挂载，淡入从第一帧开始，而不是新封面直接顶替。 */
      key={slides[0]?.key}
      aria-label="推荐轮播"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      /* 16:9：B 站首屏轮播实测 563×322，正好是这个比例。
         之前宽屏让它撑满整列高度，列一窄就变成竖版，封面被裁得只剩中间一条。 */
      className="bili-hero-swap relative mb-0 aspect-video overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--ga1)] lg:aspect-[7/5]"
    >
      {slides.map((t, i) => (
        <img
          key={t.key}
          data-track-title={t.title}
          src={thumbWide(t.cover, 1600) ?? ''}
          alt=""
          aria-hidden
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
          style={{ opacity: i === index ? 1 : 0 }}
        />
      ))}
      {/* 图片上的黑色渐变只负责让白字可读，不参与命中 */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.78),rgba(0,0,0,0.34)_46%,rgba(0,0,0,0.04))]" />
      {/* 左右箭头原来骑在竖直中线，正好压住标题首字（「coser」被切出个「oser」）。
          B 站把这对箭头收进右下角和分页点同一行，标题区整块留白给文字。 */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
        {slides.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="上一张推荐"
              onClick={() => setIndex((current) => (current - 1 + slides.length) % slides.length)}
              className="t press flex h-6 w-6 items-center justify-center rounded-[4px] bg-black/35 text-white/90 backdrop-blur-sm hover:bg-black/55 hover:text-white"
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1.5">
              {slides.map((t, i) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`第 ${i + 1} 张推荐`}
                  aria-current={i === index}
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    i === index ? 'w-7 bg-white' : 'w-3 bg-white/45 hover:bg-white/70'
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label="下一张推荐"
              onClick={() => setIndex((current) => (current + 1) % slides.length)}
              className="t press flex h-6 w-6 items-center justify-center rounded-[4px] bg-black/35 text-white/90 backdrop-blur-sm hover:bg-black/55 hover:text-white"
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onOpen(current)}
        aria-label={`观看 ${current.title}`}
        className="absolute inset-0 text-left"
      >
        <span className="absolute inset-y-0 left-0 flex max-w-[64%] flex-col justify-end gap-2.5 p-6">
          <span className="line-clamp-2 text-[26px] font-medium leading-snug text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.55)]">
            {current.title}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-white/85">
            <Avatar src={current.up_avatar ?? null} alt={current.artist} size={22} />
            <span className="truncate">{current.artist}</span>
            {current.views ? (
              <span className="num shrink-0">· {formatCount(current.views)} 播放</span>
            ) : null}
            <span className="num shrink-0">· {formatDuration(current.duration_ms)}</span>
          </span>
          <span className="mt-1 flex w-fit items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[13px] font-medium text-white">
            <Icon name="play" size={14} />
            观看
          </span>
        </span>
      </button>
      {/* B 站轮播左上角那颗红色「荐」印章：方形红底、白字、轻微倾斜。 */}
      <span
        aria-hidden
        className="absolute left-3 top-3 flex h-8 w-8 -rotate-6 items-center justify-center rounded-[4px] bg-[var(--accent)] text-[15px] font-medium text-white shadow-[0_2px_10px_rgba(0,0,0,0.25)]"
      >
        荐
      </span>
    </section>
  )
}
