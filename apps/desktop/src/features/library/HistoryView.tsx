import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { TrackGrid } from '../tracks/TrackGrid'
import { usePlayerStore } from '../player/playerStore'

/**
 * 播放历史。数据来自 SQLite 的 history 表，是真正播过的记录。
 *
 * 伪造一份「最近播放」很容易，但那不是历史——历史必须由播放动作写入。
 */
export function HistoryView() {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)

  useEffect(() => {
    let cancelled = false
    void ipc
      .libraryHistory(60)
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch((e) => {
        if (!cancelled) setError(toWireError(e).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <EmptyState icon="alert" title="读取历史失败" detail={error} action={null} />
  }
  if (tracks === null) return <TrackListSkeleton rows={6} />
  if (tracks.length === 0) {
    return (
      <EmptyState
        icon="clock"
        title="还没有播放记录"
        detail="播过的歌会自动出现在这里，下次一定。"
        action={null}
      />
    )
  }

  return (
    <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-6">
      <div className="mb-4 text-[12px] text-[var(--text-3)]">最近播放 {tracks.length} 首</div>
      <TrackGrid
        tracks={tracks}
        activeKey={snapshot?.track?.key ?? null}
        playing={snapshot?.phase === 'playing'}
      />
    </div>
  )
}
