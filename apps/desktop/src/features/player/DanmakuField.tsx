import { useEffect, useMemo, useRef, useState } from 'react'
import type { DanmakuLine } from '../../shared/lib/ipc'

/** 一条弹幕：出现时刻（毫秒）、文本、颜色、位置（1 滚动 / 4 底部 / 5 顶部）。 */
export type DanmakuItem = { at: number; text: string; color: string; mode: number }
/** 屏幕上正在飘的一条，key 里带一个自增号，避免同文本去重。 */
type Flight = DanmakuItem & { id: number; born: number; lane: number }

const LIFE_MS = 9000
/** 顶部/底部弹幕是钉住的，钉太久会糊住画面。 */
const PINNED_MS = 4000
const LANES = 10
/** 多久检查一次「有哪些新弹幕该出现」。运动本身由 CSS 跑，不受这个频率影响。 */
const SPAWN_TICK_MS = 220
/**
 * 一条车道多久后可以放下一条。
 *
 * 之前是「车道上还有活着的弹幕就不复用」，等于每条车道被独占 9 秒，
 * 十条车道上限约 1 条/秒，热视频看起来像没几条弹幕。同速弹幕不会追尾，
 * 只要前一条已经完全进入画面，这条车道就能再用。
 */
const LANE_REUSE_RATIO = 0.16

/** 一条弹幕该在屏幕上停留多久：滚动的按全场寿命，钉住的短一些。 */
function pinnedLife(item: DanmakuItem, scrollLife: number): number {
  return item.mode === 4 || item.mode === 5 ? PINNED_MS : scrollLife
}

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
  area,
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
  /** 弹幕只铺画面的这个比例：0.25 / 0.5 / 1。 */
  area: number
  /** 画面模式下降低不透明度，别挡画面。 */
  fade?: boolean
}) {
  const [flights, setFlights] = useState<Flight[]>([])
  /** 与 flights 同步的镜像：定时器里读它算下一帧，不把副作用写进 setState 的 updater。 */
  const flightsRef = useRef<Flight[]>([])
  flightsRef.current = flights
  const seq = useRef(0)
  const positionRef = useRef(position)
  positionRef.current = position
  /** 已经放到哪一条了。整场扫一遍太浪费：一部热视频几千条弹幕，220ms 一轮就是几十万次比较。 */
  const cursor = useRef(0)
  const lastPos = useRef(-1)
  /** 每条车道最近一条的出生时刻，用来判断能不能复用。 */
  const laneBorn = useRef<number[]>(new Array<number>(LANES).fill(-Infinity))
  /**
   * 弹幕要跑的距离 = 播放器宽度 + 自身宽度。
   * 之前写死 100vw（整窗宽），播放器比窗口窄时后半程在画面外空跑，
   * 既看不见又让每条露脸的时间变短。宽度用 ResizeObserver 跟着容器走。
   */
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [boxWidth, setBoxWidth] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    setBoxWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const all = useMemo(() => [...items].sort((a, b) => a.at - b.at), [items])
  /** 显示区域越小，可用车道越少，避免把十条车道压进 1/4 屏里互相叠字。 */
  const lanes = Math.max(1, Math.round(LANES * area))

  useEffect(() => {
    cursor.current = 0
    lastPos.current = -1
  }, [all])

  useEffect(() => {
    // 区域变了就重排：超出现有区域的车道直接收掉。
    laneBorn.current.fill(-Infinity)
    const kept = flightsRef.current.filter((f) => f.lane < lanes)
    flightsRef.current = kept
    setFlights(kept)
  }, [lanes])

  useEffect(() => {
    if (!enabled) return
    /** 当前速度下一条弹幕在屏幕上的总时长。CSS 的 animationDuration 用的是同一个值。 */
    const lifeMs = LIFE_MS / Math.max(speed, 0.1)
    /** 前一条走开足够远、这条再进来不会追尾。 */
    const reuseMs = lifeMs * LANE_REUSE_RATIO
    const tick = (): void => {
      const pos = positionRef.current()
      // 往回拖或换片：二分找到第一个还没过期的位置，从头对齐。
      if (pos < lastPos.current) {
        let lo = 0
        let hi = all.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (all[mid]!.at < pos - 2000) lo = mid + 1
          else hi = mid
        }
        cursor.current = lo
        // 往回拖之后，车道记录里全是「未来」的出生时刻，不复位就再也放不出新的。
        laneBorn.current.fill(-Infinity)
      }
      lastPos.current = pos

      const prev = flightsRef.current
      const alive = prev.filter((f) => pos - f.born < pinnedLife(f, lifeMs))
      // 活着但已经过了独占期的车道要放回去，否则吞吐被寿命卡死。
      for (let c = 0; c < lanes; c += 1) {
        if (pos - laneBorn.current[c]! >= reuseMs) laneBorn.current[c] = -Infinity
      }
      if (!playing) {
        if (alive.length !== prev.length) {
          flightsRef.current = alive
          setFlights(alive)
        }
        return
      }
      // 车道在生成时定死并存进条目。用数组下标算 top 的话，一条飘完被移除后
      // 其余条目下标前移，整排会瞬间跳一行。
      const fresh: Flight[] = []
      while (cursor.current < all.length && all[cursor.current]!.at <= pos - 2000) cursor.current += 1
      let i = cursor.current
      for (; i < all.length && all[i]!.at <= pos; i += 1) {
        const item = all[i]!
        if (alive.some((f) => f.at === item.at && f.text === item.text)) continue
        // 顶部/底部弹幕不占车道，钉在画面上几秒就走。
        if (item.mode === 4 || item.mode === 5) {
          seq.current += 1
          fresh.push({ ...item, id: seq.current, born: item.at, lane: -1 })
          continue
        }
        let lane = -1
        for (let c = 0; c < lanes; c += 1) {
          if (laneBorn.current[c] === -Infinity && !fresh.some((f) => f.lane === c)) {
            lane = c
            break
          }
        }
        // 车道满了就丢掉这条：B 站也是这么做的，硬塞会互相压住
        if (lane < 0) continue
        seq.current += 1
        laneBorn.current[lane] = item.at
        fresh.push({ ...item, id: seq.current, born: item.at, lane })
      }
      cursor.current = i
      if (fresh.length === 0) {
        if (alive.length !== prev.length) {
          flightsRef.current = alive
          setFlights(alive)
        }
        return
      }
      const next = [...alive, ...fresh]
      flightsRef.current = next
      setFlights(next)
    }
    const timer = window.setInterval(tick, SPAWN_TICK_MS)
    return () => window.clearInterval(timer)
  }, [all, enabled, playing, speed, lanes])

  /** 车道间距不变，区域越小能用的车道越少：1/4 屏只占画面顶部一条窄带。 */
  const laneStep = 72 / LANES

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      aria-hidden
      /* 把容器宽度交给 CSS：关键帧里用 -100% - 这个值，正好跑到左边缘外。 */
      style={{ ['--dm-travel' as string]: `${boxWidth}px` }}
    >
      {enabled
        ? flights
            .filter((f) => f.mode === 5)
            .map((f, index) => (
              <span
                key={f.id}
                className="danmaku-pinned absolute left-1/2 z-[2] -translate-x-1/2 whitespace-nowrap"
                style={{
                  top: `${6 + index * 1.6}%`,
                  color: f.color,
                  textShadow: '0 0 3px #fff, 0 0 6px #fff, 0 0 1px #fff',
                  opacity: fade ? opacity * 0.85 : opacity,
                  fontSize: `${size}px`,
                }}
              >
                {f.text}
              </span>
            ))
        : null}
      {enabled
        ? flights
            .filter((f) => f.mode === 4)
            .map((f, index) => (
              <span
                key={f.id}
                className="danmaku-pinned absolute left-1/2 z-[2] -translate-x-1/2 whitespace-nowrap"
                style={{
                  bottom: `${16 + index * 1.6}%`,
                  color: f.color,
                  textShadow: '0 0 3px #fff, 0 0 6px #fff, 0 0 1px #fff',
                  opacity: fade ? opacity * 0.85 : opacity,
                  fontSize: `${size}px`,
                }}
              >
                {f.text}
              </span>
            ))
        : null}
      {enabled && flights.length > 0
        ? flights
            .filter((f) => f.mode !== 4 && f.mode !== 5)
            .map((f) => (
            <span
              key={f.id}
              className="danmaku absolute whitespace-nowrap"
              style={{
                /* 车道只铺到画面 70.8%：底下留给进度条与控制条；
                   选了 1/4 或 1/2 屏就压进对应的上半部分。 */
                top: `${6 + f.lane * laneStep}%`,
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
          ))
        : null}
    </div>
  )
}

/** 把接口返回的弹幕转成带毫秒时间轴的条目。 */
export function toDanmakuItems(list: DanmakuLine[]): DanmakuItem[] {
  return list
    .map((line) => ({
      at: Math.round(line.secs * 1000),
      text: line.text,
      color: line.color === 0xffffff ? 'var(--text-1)' : `#${line.color.toString(16).padStart(6, '0')}`,
      mode: line.mode,
    }))
    .sort((a, b) => a.at - b.at)
}
