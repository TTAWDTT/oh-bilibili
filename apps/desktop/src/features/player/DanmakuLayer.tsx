import { useEffect, useMemo, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { readPlayhead } from '../../shared/lib/playhead'
import { usePlayerStore } from './playerStore'
import { useDanmakuSettings } from './danmakuSettings'
import { useSentDanmaku } from './sentDanmaku'

/** 一条弹幕：出现时刻（毫秒）、文本、颜色。 */
type Item = { at: number; text: string; color: string }
/** 屏幕上正在飘的一条，key 里带一个自增号，避免同文本去重。 */
type Flight = Item & { id: number; born: number }

const LIFE_MS = 9000
const MAX_ON_SCREEN = 14
/** 多久检查一次「有哪些新弹幕该出现」。motion 本身由 CSS 跑，不受这个频率影响。 */
const SPAWN_TICK_MS = 220
const EMPTY: never[] = []

/**
 * 弹幕层。
 *
 * 关键点：运动的连续性靠 CSS 动画自己跑，React 只负责「什么时候把一条放上去」。
 * 早先每 200ms 用最新位置重算 animationDelay 再渲染，等于每秒把动画重启 5 次，
 * 看起来就是一格一格地抖。
 */
export function DanmakuLayer({ trackKey }: { trackKey: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [flights, setFlights] = useState<Flight[]>([])
  const seq = useRef(0)
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const size = useDanmakuSettings((s) => s.size)
  const speed = useDanmakuSettings((s) => s.speed)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const sent = useSentDanmaku((s) => s.byTrack[trackKey] ?? EMPTY)

  useEffect(() => {
    let cancelled = false
    setItems([])
    setFlights([])
    void ipc
      .danmakuColored(trackKey)
      .then((list) => {
        if (cancelled) return
        setItems(
          list
            .map(([secs, text, rgb]) => ({
              at: Math.round(secs * 1000),
              text,
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

  // 必须 memo：不 memo 的话每次渲染都是新数组，下面那个 effect 会被
  // 反复销毁重建，定时器永远等不到第一次触发，弹幕就一条都不出。
  const all = useMemo(
    () => (sent.length === 0 ? items : [...items, ...sent].sort((a, b) => a.at - b.at)),
    [items, sent],
  )

  // 定时把「该出现了」的弹幕放上去，并收走飘完的。
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      const pos = readPlayhead()
      setFlights((prev) => {
        const alive = prev.filter((f) => pos - f.born < LIFE_MS)
        if (!playing) return alive
        const fresh: Flight[] = []
        for (const item of all) {
          if (item.at > pos || item.at <= pos - 2000) continue
          if (alive.some((f) => f.at === item.at && f.text === item.text)) continue
          seq.current += 1
          fresh.push({ ...item, id: seq.current, born: item.at })
        }
        const next = [...alive, ...fresh].slice(-MAX_ON_SCREEN)
        return next.length === prev.length && fresh.length === 0 ? prev : next
      })
    }, SPAWN_TICK_MS)
    return () => window.clearInterval(timer)
  }, [all, enabled, playing])

  if (!enabled || flights.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {flights.map((f, i) => (
        <span
          key={f.id}
          className="danmaku absolute whitespace-nowrap text-[14px]"
          style={{
            top: `${6 + ((i * 82) / MAX_ON_SCREEN)}%`,
            animationDuration: `${LIFE_MS / speed / 1000}s`,
            // 开始时刻由 born 决定，动画本身从 0 起跑，不再用负 delay 反复对齐
            animationPlayState: playing ? 'running' : 'paused',
            color: f.color,
            textShadow: '0 0 3px #fff, 0 0 6px #fff, 0 0 1px #fff',
            opacity,
            fontSize: `${size}px`,
          }}
        >
          {f.text}
        </span>
      ))}
    </div>
  )
}
