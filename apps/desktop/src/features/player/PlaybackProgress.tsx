import { useEffect, useState } from 'react'
import { formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import * as ipc from '../../shared/lib/ipc'
import { Slider } from '../../shared/ui/Slider'
import { usePlayerStore } from './playerStore'

export function PlaybackProgress() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const seek = usePlayerStore((state) => state.seek)
  const duration = snapshot?.duration_ms ?? 0
  const [now, setNow] = useState(() => readPlayhead())
  const [scrub, setScrub] = useState<number | null>(null)
  const [heat, setHeat] = useState<number[]>([])
  const trackKey = snapshot?.track?.key ?? null

  // 弹幕密度只在换歌时拉一次，进度推进不重拉。
  useEffect(() => {
    if (!trackKey) {
      setHeat([])
      return
    }
    let cancelled = false
    void ipc
      .danmakuHeat(trackKey, 80)
      .then((h) => {
        if (!cancelled) setHeat(h)
      })
      .catch(() => setHeat([]))
    return () => {
      cancelled = true
    }
  }, [trackKey])
  const peak = heat.reduce((m, v) => Math.max(m, v), 0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(readPlayhead()), 100)
    return () => window.clearInterval(timer)
  }, [])

  const ratio = scrub ?? (duration > 0 ? Math.min(1, now / duration) : 0)

  const commit = (value: number): void => {
    if (duration <= 0) return
    setScrub(value)
    void seek(value * duration).finally(() => setScrub(null))
  }

  return (
    <div className="flex w-full items-center gap-2">
      <span className="num w-9 shrink-0 text-right font-mono text-[11px] text-[var(--text-3)]">
        {formatTime(scrub === null ? now : scrub * duration)}
      </span>
      <div className="relative min-w-0 flex-1">
        {/* 高能进度条：弹幕越密的地方越亮，和 B 站播放器一致 */}
        {peak > 0 ? (
          <div className="pointer-events-none absolute -bottom-[3px] left-0 flex h-[3px] w-full items-end gap-px">
            {heat.map((v, i) => (
              <span
                key={i}
                className="flex-1 rounded-full bg-[var(--accent)]"
                style={{ height: '100%', opacity: 0.15 + (v / peak) * 0.75 }}
              />
            ))}
          </div>
        ) : null}
        <Slider
          value={ratio}
          label="播放进度"
          step={0.01}
          onChange={setScrub}
          onCommit={commit}
          disabled={duration <= 0}
        />
      </div>
      <span className="num w-9 shrink-0 font-mono text-[11px] text-[var(--text-3)]">{formatTime(duration)}</span>
    </div>
  )
}
