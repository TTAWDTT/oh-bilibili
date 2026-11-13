import { useEffect, useState } from 'react'
import { thumbUrl } from '../lib/thumb'

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
    // 2 倍像素密度：高 DPI 屏上不糊，同时仍然远小于原图。
    const scale = width ? thumbUrl(cover, Math.round(width * 2), Math.round((width * 2 * 10) / 16)) : cover
    const src = scale ?? cover
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        /* B 站图床对非 bilibili 的 Referer 一律 403，webview 默认会带页面来源，
           所以必须显式不发 Referer。缺这一条，封面在真机上全部裂图。 */
        referrerPolicy="no-referrer"
        loading="lazy"
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
