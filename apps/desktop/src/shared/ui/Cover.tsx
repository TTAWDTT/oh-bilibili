import { useEffect, useState } from 'react'

type CoverProps = {
  cover: string | null
  title: string
  className: string
}

export function Cover({ cover, title, className }: CoverProps) {
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
  }, [cover])

  if (cover && !broken) {
    return (
      <img
        src={cover}
        alt=""
        draggable={false}
        /* B 站图床对非 bilibili 的 Referer 一律 403，webview 默认会带页面来源，
           所以必须显式不发 Referer。缺这一条，封面在真机上全部裂图。 */
        referrerPolicy="no-referrer"
        loading="lazy"
        className={`${className} object-cover`}
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
      className={`${className} object-cover`}
      title={title}
    />
  )
}
