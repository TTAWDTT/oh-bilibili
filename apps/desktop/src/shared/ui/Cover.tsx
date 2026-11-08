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
  return (
    <div
      className={`${className} flex items-center justify-center`}
      style={{ background: `linear-gradient(145deg, hsl(${hue} 64% 26%), hsl(${(hue + 48) % 360} 76% 42%))` }}
      aria-hidden
    >
      <span className={glyphClassName ?? 'text-[40%] font-semibold text-white/60'}>{initials(title)}</span>
    </div>
  )
}
