import { useEffect, useState } from 'react'
import { Bili2233 } from '../../shared/ui/Bili2233'

type Slide = {
  title: string
  desc: string
  from: string
  to: string
}

/**
 * 首页大图 banner。B 站首页顶部是一张会自动切换的大图，是整个站最醒目的位置。
 *
 * 这里用渐变 + 2233 娘做轮播：三张轮流淡入，每张停留 6 秒。没有图片资源时，
 * 渐变加插画比一张假照片更合适，也更省体积。
 */
const SLIDES: Slide[] = [
  {
    title: '干杯，把 B 站的声音装进口袋',
    desc: '搜索、播放、弹幕、歌词、投币三连，全在本机完成。',
    from: 'color-mix(in oklab, var(--bili-pink) 30%, white)',
    to: 'color-mix(in oklab, var(--bili-blue) 18%, white)',
  },
  {
    title: '22 娘和 33 娘守在这里',
    desc: '每一条音轨都来自你自己的 B 站账号，不经任何中转。',
    from: 'color-mix(in oklab, var(--bili-blue) 26%, white)',
    to: 'color-mix(in oklab, var(--bili-pink) 16%, white)',
  },
  {
    title: '一键三连，也是一种收藏方式',
    desc: '点赞、投币、收进「哔哩哔哩 music」，和你账号里同步。',
    from: 'color-mix(in oklab, #ffb027 30%, white)',
    to: 'color-mix(in oklab, var(--bili-pink) 22%, white)',
  },
]

export function SearchBanner() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setActive((i) => (i + 1) % SLIDES.length), 6000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="relative mb-5 h-[196px] overflow-hidden rounded-[10px]">
      {SLIDES.map((slide, i) => (
        <div
          key={slide.title}
          aria-hidden={i !== active}
          className="bili-banner-slide absolute inset-0 transition-opacity duration-700"
          style={{
            opacity: i === active ? 1 : 0,
            background: `linear-gradient(105deg, ${slide.from} 0%, ${slide.to} 100%)`,
          }}
        >
          {/* 右上角柔光 */}
          <div
            className="pointer-events-none absolute -right-12 -top-20 h-72 w-72 rounded-full"
            style={{ background: 'radial-gradient(circle, rgb(255 255 255 / 0.9), transparent 70%)' }}
          />
          <div className="relative flex h-full items-center justify-between gap-6 px-8">
            <div className="min-w-0">
              <div className="text-[24px] font-semibold leading-tight text-[#4c3340]">{slide.title}</div>
              <p className="mt-2 max-w-[420px] text-[13px] leading-relaxed text-[#7d5a67]">{slide.desc}</p>
              <div className="mt-4 flex items-center gap-1.5">
                {SLIDES.map((_, dot) => (
                  <button
                    key={dot}
                    type="button"
                    aria-label={`第 ${dot + 1} 张`}
                    onClick={() => setActive(dot)}
                    className={[
                      'h-1.5 rounded-full transition-all duration-300',
                      dot === active ? 'w-6 bg-[var(--bili-pink)]' : 'w-1.5 bg-white/70 hover:bg-white',
                    ].join(' ')}
                  />
                ))}
              </div>
            </div>
            <div className="shrink-0 translate-y-2">
              <Bili2233 width={228} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
