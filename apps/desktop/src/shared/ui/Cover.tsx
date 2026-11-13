import { useEffect, useState } from 'react'
import { thumbWide } from '../lib/thumb'

type CoverProps = {
  cover: string | null
  title: string
  className: string
  /**
   * 目标渲染宽度（CSS 像素）。
   *
   * B 站图床支持 `@宽w_高h_1c.webp` 后缀，同一张原创封面实测 477KB → 22KB。
   * 网格卡片只有 206–380 宽，不缩图就是拿原图铺小格子，一屏能拉几 MB，
   * 表现为「划下去要等」。
   */
  width?: number
}

export function Cover({ cover, title, className, width }: CoverProps) {
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
  }, [cover])

  if (cover && !broken) {
    // 按 16:9 请求（原图比例），显示比例交给外层 CSS 裁。
    // 请求比原图更宽会让图床补黑边，16:10 的卡片格子就曾因此出现黑边。
    const src = width ? thumbWide(cover, width * 2) ?? cover : cover
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        /* B 站图床对非 bilibili 的 Referer 一律 403，webview 默认会带页面来源，
           所以必须显式不发 Referer。缺这一条，封面在真机上全部裂图。 */
        referrerPolicy="no-referrer"
        loading="lazy"
        // 解码放到别的线程：一屏几十张封面时，同步解码会卡住滚动的那一帧。
        decoding="async"
        className={`${className} cover-frame object-cover`}
        onError={() => setBroken(true)}
      />
    )
  }

  // 没有封面时用一张品牌色底图，不用渐变加斜条纹：
  // 那种兜底在浅色界面上像加载失败，读起来也不像 B 站。
  return (
    <img
      src="/assets/cover-fallback.jpg"
      alt=""
      draggable={false}
      aria-hidden
      className={`${className} cover-frame object-cover`}
      title={title}
    />
  )
}
