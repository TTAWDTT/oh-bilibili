import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '../features/player/playerStore'
import { useDanmakuSettings } from '../features/player/danmakuSettings'
import { useSentDanmaku } from '../features/player/sentDanmaku'
import { readPlayhead } from '../shared/lib/playhead'
import * as ipc from '../shared/lib/ipc'

/** 弹幕一条：出现时刻（毫秒）、文本、颜色。 */
type Item = { at: number; text: string; color: string }
/** 正在屏幕上飘的一条。id 自增，避免同文本被去重掉。 */
type Flight = Item & { id: number; born: number }

const LIFE_MS = 12000
const SPAWN_TICK_MS = 240
const LANES = 8

/**
 * 全屏弹幕层。覆盖整个内容区，按真实时间点放上屏幕。
 *
 * 和舞台里的弹幕层同一套做法：运动交给 CSS，React 只决定「什么时候放一条」。
 * 早先每次位置变化都重算 animationDelay，等于每秒重启动画 5 次，肉眼就是一格一格。
 */
export function DanmakuStrip() {
  const trackKey = usePlayerStore((state) => state.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((state) => state.snapshot?.phase === 'playing')
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const speed = useDanmakuSettings((s) => s.speed)
  const [items, setItems] = useState<Item[]>([])
  const [flights, setFlights] = useState<Flight[]>([])
  const seq = useRef(0)
  const sent = useSentDanmaku((s) => (trackKey ? (s.byTrack[trackKey] ?? EMPTY) : EMPTY))

  useEffect(() => {
    if (!trackKey) {
      setItems([])
      setFlights([])
      return
    }
    let cancelled = false
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

  const all = sent.length === 0 ? items : [...items, ...sent].sort((a, b) => a.at - b.at)

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      const pos = readPlayhead()
      setFlights((prev) => {
        const alive = prev.filter((f) => pos - f.born < LIFE_MS)
        if (!playing) return alive.length === prev.length ? prev : alive
        const fresh: Flight[] = []
        for (const item of all) {
          if (item.at > pos || item.at <= pos - 2000) continue
          if (alive.some((f) => f.at === item.at && f.text === item.text)) continue
          seq.current += 1
          fresh.push({ ...item, id: seq.current, born: item.at })
        }
        if (fresh.length === 0) return alive.length === prev.length ? prev : alive
        return [...alive, ...fresh].slice(-24)
      })
    }, SPAWN_TICK_MS)
    return () => window.clearInterval(timer)
  }, [all, enabled, playing])

  if (!enabled || !playing || flights.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      aria-hidden
      data-danmaku-fullscreen
    >
      {flights.map((f, i) => (
        <span
          key={f.id}
          className="bili-strip-item absolute whitespace-nowrap rounded-[3px] px-1.5 text-[14px]"
          style={{
            color: f.color,
            top: `${4 + ((i % LANES) * 88) / LANES}%`,
            animationDuration: `${LIFE_MS / speed / 1000}s`,
            opacity: opacity * 0.9,
            textShadow: '0 0 2px #fff, 0 0 4px #fff, 0 0 6px #fff',
            background: 'color-mix(in oklab, var(--bili-pink) 12%, white / 0.86)',
          }}
        >
          {f.text}
        </span>
      ))}
    </div>
  )
}

const EMPTY: never[] = []
