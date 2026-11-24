import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DanmakuLine } from '../../shared/lib/ipc'
import { scheduleDanmaku, visibleDanmaku } from './danmakuMerge'
import type { DanmakuItem, Flight } from './danmakuMerge'
import './danmaku-field.css'
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
  area = 1,
  singleLine = false,
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
  area?: number
  singleLine?: boolean
  /** 同一时段完全相同的滚动弹幕合成一条并累计条数。 */
  mergeSame?: boolean
  playbackRate?: number
}) {
  const positionRef = useRef(position)
  positionRef.current = position
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      setBox({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lineHeight = Math.ceil(size * 1.4)
  const inset = 4
  const availableHeight = Math.max(0, box.height - 2 * inset)
  const visibleRows = Math.floor(availableHeight / lineHeight)
  const lanes = singleLine ? 1 : Math.max(1, Math.min(Math.ceil(LANES * area), visibleRows))
  const laneStep = lanes > 1 ? (availableHeight - lineHeight) / (lanes - 1) : 0
  const life = LIFE_MS / speed
  const schedule = useMemo(
    () => scheduleDanmaku(items, mergeSame, lanes, life),
    [items, mergeSame, lanes, life],
  )
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

  return (
    <div
      ref={boxRef}
      className={`pointer-events-none absolute inset-x-0 z-10 overflow-hidden ${singleLine ? 'stage-danmaku top-1/2 -translate-y-1/2' : 'video-danmaku top-0'}`}
      aria-hidden
      style={{
        ['--dm-travel' as string]: `${box.width}px`,
        height: singleLine ? size * 1.75 : `${area * 100}%`,
        opacity,
        fontSize: size,
        lineHeight: singleLine ? undefined : `${lineHeight}px`,
      }}
    >
      {flights.map(({ flight, count }) => {
        const top = singleLine ? '6%' : inset + flight.lane * laneStep
        const ink = { color: flight.color, textShadow: singleLine ? undefined : videoTextShadow(flight.color) }
        if (flight.mode === 4 || flight.mode === 5) {
          const bottomPinned = singleLine && flight.mode === 4
          return (
            <span
              key={flight.id}
              className="danmaku-pinned absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
              style={{ ...ink, top: bottomPinned ? undefined : top, bottom: bottomPinned ? '16%' : undefined }}
            >
              {flight.text}
            </span>
          )
        }
        return (
          <ScrollingLine
            key={`${frame.epoch}:${flight.id}`} flight={flight} count={count} now={frame.now} top={top} ink={ink}
            playing={playing} playbackRate={playbackRate} life={life} merge={mergeSame}
          />
        )
      })}
    </div>
  )
}

function ScrollingLine({
  flight, count, now, top, ink, playing, playbackRate, life, merge,
}: {
  flight: Flight; count: number; now: number; top: number | string; ink: CSSProperties
  playing: boolean; playbackRate: number; life: number; merge: boolean
}) {
  // CSS 从入场时的媒体位置起跑，刷新计数时保持同一个动画实例。
  const [elapsed] = useState(() => now - flight.at)
  return (
    <span className="danmaku absolute whitespace-nowrap" style={{
      top,
      animationDuration: `${life / playbackRate}ms`,
      animationDelay: `${-elapsed / playbackRate}ms`,
      animationPlayState: playing ? 'running' : 'paused',
      ...ink,
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

function videoTextShadow(color: string): string {
  const rgb = Number.parseInt(color.slice(1), 16)
  const luminance = (rgb >> 16) * 0.213 + ((rgb >> 8) & 255) * 0.715 + (rgb & 255) * 0.072
  return luminance < 64 ? '0 0 1px #fff, 0 1px 2px #fff' : '0 0 1px #000, 0 1px 2px #000'
}

/** 把接口返回的弹幕转成带毫秒时间轴的条目。 */
export function toDanmakuItems(list: DanmakuLine[], white = '#ffffff'): DanmakuItem[] {
  return list
    .map((line) => ({
      at: Math.round(line.secs * 1000),
      text: line.text,
      color: line.color === 0xffffff ? white : `#${line.color.toString(16).padStart(6, '0')}`,
      mode: line.mode,
    }))
    .sort((a, b) => a.at - b.at)
}
