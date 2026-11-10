import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { useDanmakuSettings } from './danmakuSettings'
import { useSentDanmaku } from './sentDanmaku'

const EMPTY: never[] = []

/** 一条弹幕：出现时刻（毫秒）、文本、颜色。 */
type Item = { at: number; text: string; color: string }

/** 弹幕在屏幕上停留的时长，和 B 站默认速度接近。 */
const LIFE_MS = 9000
/** 同时最多几条，超出的丢掉——真实弹幕池一秒钟可能几十条。 */
const MAX_ON_SCREEN = 14

/**
 * 弹幕层。按视频时间轴显示——第 30 秒的弹幕在第 30 秒出现，不是随机排队飘过。
 *
 * 这一层是 B 站的文化标识，不是装饰：时刻与文本都来自这条视频的真实弹幕。
 */
export function DanmakuLayer({ trackKey, position }: { trackKey: string; position: number }) {
  const [items, setItems] = useState<Item[]>([])
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const size = useDanmakuSettings((s) => s.size)
  const speed = useDanmakuSettings((s) => s.speed)

  useEffect(() => {
    let cancelled = false
    setItems([])
    void ipc
      .danmakuColored(trackKey)
      .then((list) => {
        if (cancelled) return
        setItems(
          list
            .map(([secs, text, rgb]) => ({
              at: Math.round(secs * 1000),
              text,
              // B 站默认白字，浅色底上换成深色；其余颜色是用户自己选的，原样保留。
              color: rgb === 0xffffff ? 'var(--text-1)' : `#${rgb.toString(16).padStart(6, '0')}`,
            }))
            .sort((a, b) => a.at - b.at),
        )
      })
      .catch(() => setItems([]))
    return () => {
      cancelled = true
    }
  }, [trackKey])

  const sent = useSentDanmaku((s) => s.byTrack[trackKey] ?? EMPTY)
  const merged = useMemo(() => {
    if (sent.length === 0) return items
    const seen = new Set(items.map((i) => `${i.at}-${i.text}`))
    const extra = sent.filter((i) => !seen.has(`${i.at}-${i.text}`))
    return [...items, ...extra].sort((a, b) => a.at - b.at)
  }, [items, sent])

  // 只取「已经开始、还没飘完」的那一段。位置一变就重算，弹幕于是跟着时间出现。
  const onScreen = useMemo(() => {
    if (merged.length === 0) return []
    const from = position - LIFE_MS
    return merged.filter((d) => d.at <= position && d.at > from).slice(0, MAX_ON_SCREEN)
  }, [merged, position])

  if (!enabled || onScreen.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {onScreen.map((item, i) => (
        <span
          key={`${item.at}-${item.text}-${i}`}
          className="danmaku absolute whitespace-nowrap text-[14px]"
          style={{
            // 铺满整屏：B 站全屏弹幕就是从上到下的，只占上半屏会显得空
            // 且容易互相压住。按条数均分高度，留出上下边距。
            top: `${6 + (i * 82) / MAX_ON_SCREEN}%`,
            // 已经飘了多久决定它现在到哪：位置越靠后，越接近左边缘
            animationDuration: `${LIFE_MS / speed / 1000}s`,
            animationDelay: `-${(position - item.at) / 1000}s`,
            animationPlayState: 'paused',
            color: item.color,
            textShadow: '0 0 3px #fff, 0 0 6px #fff, 0 0 1px #fff',
            opacity,
            fontSize: `${size}px`,
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  )
}
