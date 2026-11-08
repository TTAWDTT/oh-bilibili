import { useEffect, useState } from 'react'
import { hueFor, initials } from '../lib/format'

type CoverProps = {
  cover: string | null
  title: string
  className: string
  glyphClassName?: string
}

export function Cover({ cover, title, className, glyphClassName }: CoverProps) {
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
        className={`${className} object-cover`}
        onError={() => setBroken(true)}
      />
    )
  }

  const hue = hueFor(title)
  // 没有封面时的兜底：B 站风格的斜条纹 + 首字。
  // 纯色块在列表里看起来像加载失败，条纹能立刻读成「这是设计好的占位」。
  return (
    <div className={`${className} relative flex items-center justify-center overflow-hidden`} aria-hidden>
      <span
        className="absolute inset-0"
        style={{
          background: `linear-gradient(145deg, hsl(${hue} 42% 22%), hsl(${(hue + 34) % 360} 46% 34%))`,
        }}
      />
      <span
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.9) 0 1px, transparent 1px 7px)',
        }}
      />
      <span
        className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--accent)] opacity-60"
      />
      <span className={`relative ${glyphClassName ?? 'text-[40%] font-semibold text-white/80'}`}>
        {initials(title)}
      </span>
    </div>
  )
}
