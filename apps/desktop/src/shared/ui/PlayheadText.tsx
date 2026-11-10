import { useEffect, useState } from 'react'
import { readPlayhead } from '../lib/playhead'
import { formatTime } from '../lib/format'

/**
 * 只显示当前位置的一段文字，自己按 500ms 刷新。
 *
 * 早先它读 snapshot.position_ms，而后端每 200ms 推一次进度、每次都写回
 * snapshot——于是所有订阅 snapshot 的组件（含整个状态栏）每秒重渲染 5 次。
 * 现在进度不再进 snapshot，需要看时间的组件各自读 readPlayhead()，
 * 刷新频率也降到肉眼看时间够用的 2Hz。
 */
export function PlayheadText({ durationMs, className }: { durationMs: number; className?: string }) {
  const [now, setNow] = useState(() => readPlayhead())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(readPlayhead()), 500)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span className={className}>
      {formatTime(now)} / {formatTime(durationMs)}
    </span>
  )
}
