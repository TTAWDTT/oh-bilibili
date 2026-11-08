import { useEffect, useMemo, useState } from 'react'
import type { Track } from './contract'
import { hueFor } from './format'

export type Accent = {
  hue: number
  accent: string
  soft: string
  deep: string
}

const DEFAULT_HUE = 214

/**
 * 封面色相只用来「染色」，不用来「发光」。
 *
 * 之前的饱和度是 90% 上下，等于把三团霓虹铺满整屏；现在：
 * - accent 是给进度条、激活态这类小面积元素用的，中等饱和
 * - soft / deep 是氛围层，饱和度压到 18% 以下、透明度 0.10 以下，
 *   最终读起来接近中性灰，只在长时间看时才感觉得到色调
 * - 只保留一个色相，去掉 hue+22 / hue+334 那种彩虹组合
 */
function accentFor(hue: number): Accent {
  return {
    hue,
    accent: `hsl(${hue} 46% 70%)`,
    soft: `hsl(${hue} 16% 62% / 0.09)`,
    deep: `hsl(${hue} 14% 46% / 0.07)`,
  }
}

function rgbToHue(red: number, green: number, blue: number): number | null {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta < 0.06 || max < 0.08) return null
  let hue = 0
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return Math.round(((hue * 60) % 360 + 360) % 360)
}

/** 封面主色决定整个页面的色晕；取不到像素（跨域、加载失败）时退回 key 推导的色相。 */
export function useTrackAccent(track: Track | null): Accent {
  const [hue, setHue] = useState(() => (track ? hueFor(track.key) : DEFAULT_HUE))
  const cover = track?.cover ?? null
  const key = track?.key ?? ''

  useEffect(() => {
    if (!cover) {
      setHue(key ? hueFor(key) : DEFAULT_HUE)
      return
    }
    setHue(hueFor(key))
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (cancelled) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        const context = canvas.getContext('2d')
        if (!context) return
        context.drawImage(image, 0, 0, 8, 8)
        const pixels = context.getImageData(0, 0, 8, 8).data
        let red = 0
        let green = 0
        let blue = 0
        let counted = 0
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] ?? 0
          if (alpha < 40) continue
          red += pixels[index] ?? 0
          green += pixels[index + 1] ?? 0
          blue += pixels[index + 2] ?? 0
          counted += 1
        }
        if (counted === 0) return
        const found = rgbToHue(red / counted, green / counted, blue / counted)
        if (found !== null) setHue(found)
      } catch {
        // 跨域画布读不出像素；用 key 的色相已经足够稳定。
      }
    }
    image.src = cover
    return () => {
      cancelled = true
      image.onload = null
    }
  }, [cover, key])

  return useMemo(() => accentFor(hue), [hue])
}

export function useAccentVars(accent: Accent): void {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', accent.accent)
    root.style.setProperty('--accent-soft', accent.soft)
    root.style.setProperty('--accent-deep', accent.deep)
  }, [accent])
}
