import { useEffect, useState } from 'react'
import { formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { Slider } from '../../shared/ui/Slider'
import { usePlayerStore } from './playerStore'

export function PlaybackProgress() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const seek = usePlayerStore((state) => state.seek)
  const duration = snapshot?.duration_ms ?? 0
  const [now, setNow] = useState(() => readPlayhead())
  const [scrub, setScrub] = useState<number | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(readPlayhead()), 100)
    return () => window.clearInterval(timer)
  }, [])

  const ratio = scrub ?? (duration > 0 ? Math.min(1, now / duration) : 0)
  const shown = scrub === null ? Math.min(now, duration) : scrub * duration

  const commit = (value: number): void => {
    if (duration <= 0) return
    setScrub(value)
    void seek(value * duration).finally(() => setScrub(null))
  }

  return (
    <div className="flex w-full items-center gap-3">
      <span className="num w-10 shrink-0 text-right font-mono text-[10.5px] text-white/44">{formatTime(shown)}</span>
      <div className="min-w-0 flex-1">
        <Slider
          value={ratio}
          label="播放进度"
          step={0.01}
          onChange={setScrub}
          onCommit={commit}
          disabled={duration <= 0}
        />
      </div>
      <span className="num w-10 shrink-0 font-mono text-[10.5px] text-white/44">{formatTime(duration)}</span>
    </div>
  )
}
