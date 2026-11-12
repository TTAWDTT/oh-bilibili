import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { PageTitle } from '../../shared/ui/PageTitle'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { PARTS } from '../../shared/lib/biliParts'
import { useAppStore } from '../../app/appStore'

/**
 * 排行榜。读的是 B 站公开榜单，一次 100 条；名次就是接口返回的顺序。
 * 卡片左上角的名次用 B 站前三名的红 / 橙 / 黄。
 */
export function RankingView({ initialRid = 0 }: { initialRid?: number }) {
  const [rid, setRid] = useState(initialRid)
  const replace = useAppStore((s) => s.replace)
  const [nonce, setNonce] = useState(0)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)

  useEffect(() => {
    let cancelled = false
    // 换分区就是换一份榜，停在上一份的滚动位置会读到一半。
    scrollRef.current?.scrollTo({ top: 0 })
    setTracks(null)
    setError(null)
    void ipc
      .ranking(rid)
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [rid, nonce])

  return (
    <div
      ref={scrollRef}
      id="scroll-main"
      className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <PageTitle extra={tracks ? String(tracks.length) : undefined}>排行榜</PageTitle>
      <div className="mb-4 flex flex-wrap gap-1">
        {PARTS.map((part) => (
          <button
            key={part.rid}
            type="button"
            aria-pressed={part.rid === rid}
            onClick={() => {
              setRid(part.rid)
              // 记进当前视图：从视频页返回时还落在同一个分区
              replace({ kind: 'ranking', rid: part.rid })
            }}
            className={`t press rounded-[4px] px-3 py-1 text-[13px] ${
              part.rid === rid
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)]'
            }`}
          >
            {part.name}
          </button>
        ))}
      </div>
      {error ? (
        <EmptyState
          icon="alert"
          title="榜单没取到"
          detail={error}
          action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }}
        />
      ) : tracks === null ? (
        <CardGridSkeleton cards={10} />
      ) : tracks.length === 0 ? (
        <EmptyState icon="biliTv" title="这个分区今天没有榜单" action={null} />
      ) : (
        <ContentGrid
          tracks={tracks}
          ranked
          activeKey={snapshot?.track?.key ?? null}
          playing={snapshot?.phase === 'playing'}
        />
      )}
    </div>
  )
}
