import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsPlaying, usePlayerStore } from '../features/player/playerStore'
import { useDanmakuSettings } from '../features/player/danmakuSettings'
import { useSentDanmaku } from '../features/player/sentDanmaku'
import { readPlayhead } from '../shared/lib/playhead'
import * as ipc from '../shared/lib/ipc'

/** 弹幕一条：出现时刻（毫秒）、文本、颜色。 */
type Item = { at: number; text: string; color: string }
/** 正在屏幕上飘的一条。id 自增，避免同文本被去重掉。 */
type Flight = Item & { id: number; born: number; lane: number }

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
  const playing = useIsPlaying()
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
            .map((line) => ({
              at: Math.round(line.secs * 1000),
              text: line.text,
              color:
                line.color === 0xffffff
                  ? 'var(--text-1)'
                  : `#${line.color.toString(16).padStart(6, '0')}`,
              mode: line.mode,
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

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      const pos = readPlayhead()
      setFlights((prev) => {
        const alive = prev.filter((f) => pos - f.born < LIFE_MS)
        if (!playing) return alive.length === prev.length ? prev : alive
        // 车道在生成时定死并记住。用数组下标算纵向位置的话，一条飘完被移除后
        // 其余条目下标前移，整排会瞬间跳一行——那就是肉眼看到的「跳动」。
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
          if (lane < 0) continue // 车道满了就丢弃，硬塞会互相压住
          seq.current += 1
          fresh.push({ ...item, id: seq.current, born: item.at, lane })
        }
        if (fresh.length === 0) return alive.length === prev.length ? prev : alive
        return [...alive, ...fresh]
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
      {flights.map((f) => (
        <span
          key={f.id}
          className="bili-strip-item absolute whitespace-nowrap rounded-[3px] px-1.5 text-[14px]"
          style={{
            color: f.color,
            top: `${4 + (f.lane * 88) / LANES}%`,
            animationDuration: `${LIFE_MS / speed / 1000}s`,
            opacity: opacity * 0.9,
            textShadow: '0 0 2px #fff, 0 0 4px #fff, 0 0 6px #fff',
            background: 'color-mix(in oklab, var(--accent) 10%, white / 0.86)',
          }}
        >
          {f.text}
        </span>
      ))}
    </div>
  )
}

const EMPTY: never[] = []
