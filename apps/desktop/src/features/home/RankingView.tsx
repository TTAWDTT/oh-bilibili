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
    <div ref={scrollRef} id="scroll-main" className="min-h-0 flex-1 overflow-y-auto pb-10">
      {/*
       * B 站排行榜页是白色 header 带：标题、一行口径说明、一排文字 tab（选中项挂蓝色下划线）。
       * 之前用灰色胶囊平铺在灰底上，跟榜单页原版完全不是一个东西，也没有说清楚这个榜怎么排的。
       */}
      <nav className="mb-3 border-b border-[var(--line)] bg-[var(--panel)] px-4 pb-0 pt-4 md:px-8">
        <PageTitle extra={tracks ? String(tracks.length) : undefined}>排行榜</PageTitle>
        <p className="-mt-2 mb-3 text-[12px] text-[var(--text-3)]">
          榜单根据稿件内容质量与近期数据综合排序，动态更新
        </p>
        <div className="no-scrollbar -mb-px flex items-center gap-5 overflow-x-auto">
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
              className={`t shrink-0 whitespace-nowrap border-b-2 pb-2 text-[14px] ${
                part.rid === rid
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-2)] hover:text-[var(--accent)]'
              }`}
            >
              {part.name}
            </button>
          ))}
        </div>
      </nav>
      <div className="px-4 md:px-8">
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
    </div>
  )
}
