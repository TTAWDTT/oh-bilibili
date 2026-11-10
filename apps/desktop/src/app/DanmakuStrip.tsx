import { useEffect, useMemo, useState } from 'react'
import { usePlayerStore } from '../features/player/playerStore'
import { useDanmakuSettings } from '../features/player/danmakuSettings'
import * as ipc from '../shared/lib/ipc'

/** 弹幕一条：出现时刻（毫秒）、文本、颜色。 */
type Item = { at: number; text: string; color: string }

/** 一条弹幕在带上停留的时长。 */
const LIFE_MS = 12000

/**
 * 全局弹幕带。播放时把当前时刻的真实弹幕送过顶部。
 *
 * 和舞台里的弹幕层用同一份数据、同一个时间轴：
 * 播放到第 30 秒，带的也是第 30 秒前后的弹幕。
 */
export function DanmakuStrip() {
  const trackKey = usePlayerStore((state) => state.snapshot?.track?.key ?? null)
  const position = usePlayerStore((state) => state.snapshot?.position_ms ?? 0)
  const playing = usePlayerStore((state) => state.snapshot?.phase === 'playing')
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const speed = useDanmakuSettings((s) => s.speed)
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    if (!trackKey) {
      setItems([])
      return
    }
    let cancelled = false
    void ipc
      .danmakuColored(trackKey)
      .then((list) => {
        if (cancelled) return
        setItems(
          list
            .map(([secs, text, rgb]) => ({
              at: Math.round(secs * 1000),
              text,
              // B 站默认白字在浅色底上改用深色；其余是用户选的颜色，原样保留。
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

  // 只带「刚出现过」的那几条，和舞台用的是同一套窗口逻辑。
  const visible = useMemo(() => {
    if (items.length === 0) return []
    const from = position - LIFE_MS
    return items.filter((d) => d.at <= position && d.at > from).slice(-8)
  }, [items, position])

  if (!enabled || !playing || visible.length === 0) return null

  // 铺满内容区的全屏弹幕：原来只是一条 24px 高的带子，一次只看得到一两句。
  // 现在按 8 条车道从上到下排开，压在内容上方，pointer-events-none 不挡操作。
  const LANES = 8
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      aria-hidden
      data-danmaku-fullscreen
    >
      {visible.map((item, i) => (
        <span
          key={`${item.at}-${item.text}-${i}`}
          className="bili-strip-item absolute whitespace-nowrap rounded-[3px] px-1.5 text-[14px]"
          style={{
            color: item.color,
            top: `${4 + ((i % LANES) * 88) / LANES}%`,
            animationDuration: `${LIFE_MS / speed / 1000}s`,
            // 负延迟让它落在已经飘过的那一段，而不是从右边缘重新开始
            animationDelay: `-${(position - item.at) / 1000}s`,
            animationPlayState: 'paused',
            opacity: opacity * 0.9,
            textShadow: '0 0 2px #fff, 0 0 4px #fff, 0 0 6px #fff',
            background: 'color-mix(in oklab, var(--bili-pink) 12%, white / 0.86)',
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  )
}
