import { useEffect, useMemo, useRef, useState } from 'react'
import type { DanmakuLine } from '../../shared/lib/ipc'
import { scheduleDanmaku, visibleDanmaku } from './danmakuMerge'
import type { DanmakuItem, Flight } from './danmakuMerge'
export type { DanmakuItem } from './danmakuMerge'

const LIFE_MS = 9000
const LANES = 10
const SPAWN_TICK_MS = 160

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
  mergeSame = false,
  playbackRate = 1,
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
  /** 同一时段完全相同的滚动弹幕合成一条并累计条数。 */
  mergeSame?: boolean
  playbackRate?: number
}) {
  const positionRef = useRef(position)
  positionRef.current = position
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

  const lanes = Math.max(1, Math.round(LANES * area))
  const life = LIFE_MS / speed
  const schedule = useMemo(() => scheduleDanmaku(items, mergeSame, lanes, life), [items, mergeSame, lanes, life])
  const [frame, setFrame] = useState({ now: 0, epoch: 0 })
  useEffect(() => {
    if (!enabled) return
    let previous = positionRef.current()
    setFrame((frame) => ({ now: previous, epoch: frame.epoch + 1 }))
    const timer = window.setInterval(() => {
      const now = positionRef.current()
      if (now === previous) return
      const seek = now < previous || now - previous > 2 * SPAWN_TICK_MS * playbackRate
      previous = now
      setFrame((frame) => ({ now, epoch: frame.epoch + Number(seek) }))
    }, SPAWN_TICK_MS)
    return () => window.clearInterval(timer)
  }, [enabled, schedule, playbackRate])

  const flights = enabled ? visibleDanmaku(schedule, frame.now, life) : []
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
            .map(({ flight }) => flight)
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
            .map(({ flight }) => flight)
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
      {flights.filter(({ flight }) => flight.lane >= 0).map(({ flight, count }) => (
        <ScrollingLine
          key={`${frame.epoch}:${flight.id}`} flight={flight} count={count} now={frame.now}
          laneStep={laneStep} opacity={fade ? opacity * 0.85 : opacity} size={size}
          playing={playing} playbackRate={playbackRate} life={life} merge={mergeSame}
        />
      ))}
    </div>
  )
}

function ScrollingLine({
  flight, count, now, laneStep, opacity, size, playing, playbackRate, life, merge,
}: {
  flight: Flight; count: number; now: number; laneStep: number; opacity: number
  size: number; playing: boolean; playbackRate: number; life: number; merge: boolean
}) {
  // CSS 从入场时的媒体位置起跑，刷新计数时保持同一个动画实例。
  const [elapsed] = useState(() => now - flight.at)
  return (
    <span className="danmaku absolute whitespace-nowrap" style={{
      top: `${6 + flight.lane * laneStep}%`,
      animationDuration: `${life / playbackRate}ms`,
      animationDelay: `${-elapsed / playbackRate}ms`,
      animationPlayState: playing ? 'running' : 'paused',
      color: flight.color, opacity, fontSize: size,
      textShadow: '0 0 3px #fff, 0 0 6px #fff, 0 0 1px #fff',
    }}>
      {flight.text}
      {merge && flight.mode === 1 ? (
        <span className="num ml-1 inline-block min-w-[3ch] tabular-nums text-[0.82em] text-[#ffd76a]">
          {count > 1 ? `×${count}` : ''}
        </span>
      ) : null}
    </span>
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
