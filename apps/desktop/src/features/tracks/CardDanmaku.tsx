import { useEffect, useMemo, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'

/** 一条弹幕：文本与颜色。 */
type Line = { text: string; color: string }

/**
 * 卡片 hover 时飘出的真实弹幕。
 *
 * B 站的搜索页在悬停预览里就飘弹幕，这是它区别于普通视频站的地方。
 * 这里只在这个卡片第一次被悬停时才请求，30 张卡不会在加载时打出 30 个请求。
 */
export function CardDanmaku({ trackKey }: { trackKey: string }) {
  const [lines, setLines] = useState<Line[]>([])
  const asked = useRef(false)
  const selfRef = useRef<HTMLSpanElement | null>(null)
  // StrictMode 会挂载→卸载→再挂载。卸载时不能把 asked 置真，
  // 否则重新挂载后永远不请求（这个坑实测踩过）。
  const alive = useRef(true)

  const load = (): void => {
    if (asked.current) return
    asked.current = true
    void ipc
      .danmakuColored(trackKey)
      .then((list) => {
        if (!alive.current) return
        // 彩色弹幕优先：白字压在封面上不如彩色好看，全是白字的就退回白字
        const colored = list.filter(([, , rgb]) => rgb !== 0xffffff)
        const picked = (colored.length >= 3 ? colored : list).slice(0, 5)
        setLines(
          picked.map(([, text, rgb]) => ({
            text,
            color: rgb === 0xffffff ? '#ffffff' : `#${rgb.toString(16).padStart(6, '0')}`,
          })),
        )
      })
      .catch(() => {
        if (alive.current) setLines([])
      })
  }

  // 监听触发器挂在卡片本身：这一层是 pointer-events-none，收不到 hover 事件。
  useEffect(() => {
    // 重新挂载时要把「还活着」复位，否则 StrictMode 的第二次挂载读到的是
    // 上一次 cleanup 写的 false，请求回来了也白丢。
    alive.current = true
    const self = selfRef.current
    const card = self?.closest('[data-track-card]')
    if (!card) return
    const onEnter = (): void => load()
    card.addEventListener('pointerenter', onEnter)
    return () => {
      card.removeEventListener('pointerenter', onEnter)
      alive.current = false
    }
    // load 只用到 ref 与 setState，稳定；故意不列依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = useMemo(() => lines.slice(0, 3), [lines])

  return (
    <span
      ref={selfRef}
      className="card-danmaku-layer pointer-events-none absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      aria-hidden
    >
      {items.map((line, i) => (
        <span
          key={`${line.text}-${i}`}
          className="card-danmaku absolute whitespace-nowrap text-[12px] font-medium"
          style={{
            top: `${16 + i * 22}%`,
            color: line.color,
            textShadow: '0 0 2px rgba(0,0,0,.9), 0 0 4px rgba(0,0,0,.7)',
            animationDuration: `${7 + i * 1.5}s`,
            animationDelay: `${i * 0.6}s`,
          }}
        >
          {line.text}
        </span>
      ))}
    </span>
  )
}
