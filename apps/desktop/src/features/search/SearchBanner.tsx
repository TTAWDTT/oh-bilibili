import { useEffect, useState } from 'react'

type Slide = {
  image: string | undefined
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
    image: '/assets/banner-1.png',
    title: '干杯，把 B 站的声音装进口袋',
    desc: '搜索、播放、弹幕、歌词、投币三连，全在本机完成。',
    from: '#ff5c8a',
    to: '#7b6bff',
  },
  {
    image: '/assets/banner-2.jpg',
    title: '22 娘和 33 娘守在这里',
    desc: '每一条音轨都来自你自己的 B 站账号，不经任何中转。',
    from: '#00aeec',
    to: '#ff6699',
  },
  {
    image: '/assets/banner-3.jpg',
    title: '一键三连，也是一种收藏方式',
    desc: '点赞、投币、收进「哔哩哔哩 music」，和你账号里同步。',
    from: '#ff9f2e',
    to: '#ff5c8a',
  },
]

export function SearchBanner() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setActive((i) => (i + 1) % SLIDES.length), 6000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="relative h-full min-h-[236px] overflow-hidden rounded-[8px]">
      {SLIDES.map((slide, i) => (
        <div
          key={slide.title}
          aria-hidden={i !== active}
          className="bili-banner-slide absolute inset-0 transition-opacity duration-700"
          style={{ opacity: i === active ? 1 : 0 }}
        >
          {slide.image ? (
            <img
              src={slide.image}
              alt=""
              aria-hidden
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full scale-110 object-cover"
            />
          ) : null}
          <div
            className="absolute inset-0"
            style={{
              background: slide.image
                ? `linear-gradient(100deg, rgb(0 0 0 / 0.82) 0%, rgb(0 0 0 / 0.55) 38%, rgb(0 0 0 / 0.12) 70%, transparent 100%)`
                : `linear-gradient(105deg, ${slide.from} 0%, ${slide.to} 100%)`,
            }}
          />
          {/* 右上角柔光 */}
          <div
            className="pointer-events-none absolute -right-12 -top-20 h-72 w-72 rounded-full"
            style={{ background: 'radial-gradient(circle, rgb(255 255 255 / 0.9), transparent 70%)' }}
          />
          <div className="relative flex h-full items-center justify-between gap-6 px-8">
            <div className="min-w-0">
              <div className="text-[24px] font-semibold leading-tight text-white">{slide.title}</div>
              <p className="mt-2 max-w-[420px] text-[14px] leading-relaxed text-white/85">{slide.desc}</p>
              <div className="mt-4 flex items-center gap-1.5">
                {SLIDES.map((_, dot) => (
                  <button
                    key={dot}
                    type="button"
                    aria-label={`第 ${dot + 1} 张`}
                    onClick={() => setActive(dot)}
                    className={[
                      'h-1.5 rounded-full transition-all duration-300',
                      dot === active ? 'w-6 bg-[var(--accent)]' : 'w-1.5 bg-white/70 hover:bg-white',
                    ].join(' ')}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
