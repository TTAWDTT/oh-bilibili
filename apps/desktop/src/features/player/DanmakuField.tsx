import { useEffect, useMemo, useRef, useState } from 'react'

/** 一条弹幕：出现时刻（毫秒）、文本、颜色。 */
export type DanmakuItem = { at: number; text: string; color: string }
/** 屏幕上正在飘的一条，key 里带一个自增号，避免同文本去重。 */
type Flight = DanmakuItem & { id: number; born: number; lane: number }

const LIFE_MS = 9000
const LANES = 10
/** 多久检查一次「有哪些新弹幕该出现」。运动本身由 CSS 跑，不受这个频率影响。 */
const SPAWN_TICK_MS = 220

/**
 * 弹幕层本体。
 *
 * 位置从外面给，不自己读时钟：音乐模式给音频时钟，观看页给视频的 currentTime。
 * 同一份实现服务两个时间轴，也就不会出现「一处修好、另一处还是旧行为」。
 *
 * 运动的连续性靠 CSS 动画自己跑，React 只负责「什么时候把一条放上去」。
 */
export function DanmakuField({
  items,
  position,
  playing,
  enabled,
  opacity,
  size,
  speed,
  fade = false,
}: {
  items: DanmakuItem[]
  /** 返回当前位置（毫秒）。存进 ref，所以父组件不需要为它重渲染。 */
  position: () => number
  playing: boolean
  enabled: boolean
  opacity: number
  size: number
  speed: number
  /** 画面模式下降低不透明度，别挡画面。 */
  fade?: boolean
}) {
  const [flights, setFlights] = useState<Flight[]>([])
  const seq = useRef(0)
  const positionRef = useRef(position)
  positionRef.current = position

  const all = useMemo(() => [...items].sort((a, b) => a.at - b.at), [items])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      const pos = positionRef.current()
      setFlights((prev) => {
        const alive = prev.filter((f) => pos - f.born < LIFE_MS)
        if (!playing) return alive.length === prev.length ? prev : alive
        // 车道在生成时定死并存进条目。用数组下标算 top 的话，一条飘完被移除后
        // 其余条目下标前移，整排会瞬间跳一行。
        const used = new Set(alive.map((f) => f.lane))
        const fresh: Flight[] = []
        for (const item of all) {
          if (item.at > pos || item.at <= pos - 2000) continue
          if (alive.some((f) => f.at === item.at && f.text === item.text)) continue
          let lane = -1
          for (let c = 0; c < LANES; c += 1) {
            if (!used.has(c) && !fresh.some((f) => f.lane === c)) {
              lane = c
              break
            }
          }
          // 车道满了就丢掉这条：B 站也是这么做的，硬塞会互相压住
          if (lane < 0) continue
          seq.current += 1
          fresh.push({ ...item, id: seq.current, born: item.at, lane })
        }
        if (fresh.length === 0) return alive.length === prev.length ? prev : alive
        return [...alive, ...fresh]
      })
    }, SPAWN_TICK_MS)
    return () => window.clearInterval(timer)
  }, [all, enabled, playing])

  if (!enabled || flights.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {flights.map((f) => (
        <span
          key={f.id}
          className="danmaku absolute whitespace-nowrap"
          style={{
            top: `${6 + (f.lane * 82) / LANES}%`,
            animationDuration: `${LIFE_MS / speed / 1000}s`,
            animationPlayState: playing ? 'running' : 'paused',
            color: f.color,
            textShadow: '0 0 3px #fff, 0 0 6px #fff, 0 0 1px #fff',
            opacity: fade ? opacity * 0.85 : opacity,
            fontSize: `${size}px`,
          }}
        >
          {f.text}
        </span>
      ))}
    </div>
  )
}

/** 把接口返回的 `[秒, 文本, 颜色]` 转成带毫秒时间轴的条目。 */
export function toDanmakuItems(list: [number, string, number][]): DanmakuItem[] {
  return list
    .map(([secs, text, rgb]) => ({
      at: Math.round(secs * 1000),
      text,
      color: rgb === 0xffffff ? 'var(--text-1)' : `#${rgb.toString(16).padStart(6, '0')}`,
    }))
    .sort((a, b) => a.at - b.at)
}
