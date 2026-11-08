import { Bili2233 } from '../../shared/ui/Bili2233'

/**
 * 搜索页顶部的横向横幅。
 *
 * B 站首页顶部有一条大图 banner，是它最好认的一处。这里用渐变 + 2233 + 一句标语
 * 复刻那个位置，让打开应用的第一眼就是 B 站的样子。
 */
export function SearchBanner() {
  return (
    <div className="relative mb-5 overflow-hidden rounded-[8px]">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(105deg, color-mix(in oklab, var(--bili-pink) 22%, white) 0%, color-mix(in oklab, var(--bili-pink) 8%, white) 46%, color-mix(in oklab, var(--bili-blue) 14%, white) 100%)',
        }}
      />
      {/* 右上角一枚圆形的柔光，B 站 banner 常见的高光处理 */}
      <div
        className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full"
        style={{ background: 'radial-gradient(circle, rgb(255 255 255 / 0.85), transparent 70%)' }}
      />
      <div className="relative flex items-center justify-between gap-6 px-6 py-5">
        <div className="min-w-0">
          <div className="text-[19px] font-semibold leading-tight text-[#5b3b46]">
            干杯，把 B 站的声音装进口袋
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[#8a6470]">
            搜索、播放、弹幕、歌词、投币三连，全在本机完成。
          </p>
        </div>
        <div className="shrink-0">
          <Bili2233 width={168} />
        </div>
      </div>
    </div>
  )
}
