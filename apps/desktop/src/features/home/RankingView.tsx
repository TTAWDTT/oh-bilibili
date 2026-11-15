import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { usePlayerStore } from '../player/playerStore'
import { PARTS } from '../../shared/lib/biliParts'
import { useAppStore } from '../../app/appStore'
import { HotTabs } from './HotTabs'

/** 名次底色：B 站前三是粉红 / 橙 / 黄，其余是一块半透明黑。 */
function rankTone(rank: number): string {
  if (rank === 1) return 'var(--accent)'
  if (rank === 2) return '#ff8f3f'
  if (rank === 3) return '#f6c34a'
  return 'rgba(0,0,0,0.55)'
}

/**
 * 榜单的一行。B 站排行榜不是封面网格，是两列横排列表：
 * 左边封面（左上角压名次），右边标题两行 + UP + 播放/弹幕。
 * 这里也照做，不再套发现页那套卡片，否则名次只是一个角标，榜单感全丢。
 */
function RankRow({ track, rank, active, onOpen, onAuthor }: {
  track: Track
  rank: number
  active: boolean
  onOpen: () => void
  onAuthor: () => void
}) {
  return (
    <div className="group flex items-start gap-3.5">
      <button type="button" onClick={onOpen} className="relative shrink-0" title={track.title}>
        <span className="relative block aspect-video w-[168px] overflow-hidden rounded-[6px]">
          <Cover cover={track.cover} title={track.title} width={168} className="h-full w-full" />
          <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/60 px-1 text-[11px] leading-[16px] text-white">
            {formatDuration(track.duration_ms)}
          </span>
        </span>
        <span
          className="num absolute left-0 top-0 flex h-[22px] w-[22px] items-center justify-center rounded-tl-[6px] rounded-br-[6px] text-[12px] font-medium text-white"
          style={{ background: rankTone(rank) }}
        >
          {rank}
        </span>
      </button>
      <span className="min-w-0 flex-1 py-0.5">
        <button
          type="button"
          onClick={onOpen}
          title={track.title}
          className={`line-clamp-2 block text-left text-[15px] font-medium leading-[22px] hover:text-[var(--accent)] ${
            active ? 'text-[var(--accent)]' : 'text-[var(--text-1)]'
          }`}
        >
          {track.title}
        </button>
        <button
          type="button"
          onClick={onAuthor}
          className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[14px]">UP</span>
          <span className="truncate">{track.artist}</span>
        </button>
        <span className="num mt-1 flex items-center gap-3 text-[12px] text-[var(--text-3)]">
          {track.views ? (
            <span className="flex items-center gap-0.5">
              <Icon name="play" size={11} />
              {formatCount(track.views)}
            </span>
          ) : null}
          {(track.danmaku ?? 0) > 0 ? (
            <span className="flex items-center gap-0.5">
              <Icon name="danmaku" size={11} />
              {formatCount(track.danmaku!)}
            </span>
          ) : null}
        </span>
      </span>
    </div>
  )
}

/**
 * 排行榜。读的是 B 站公开榜单，一次 100 条；名次就是接口返回的顺序。
 * 卡片左上角的名次用 B 站前三名的红 / 橙 / 黄。
 */
export function RankingView({ initialRid = 0 }: { initialRid?: number }) {
  const [rid, setRid] = useState(initialRid)
  const replace = useAppStore((s) => s.replace)
  const navigate = useAppStore((s) => s.navigate)
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
      <HotTabs
        active="ranking"
        title="排行榜"
        extra={tracks ? String(tracks.length) : undefined}
        below={
          <div className="no-scrollbar -mb-px flex items-center gap-5 overflow-x-auto border-b border-[var(--line)]">
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
        }
      >
      </HotTabs>
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
        <EmptyState mascot="missYou" icon="biliTv" title="这个分区今天没有榜单" action={null} />
      ) : (
        /* 两列横排列表：B 站榜单在宽屏就是左右各一列，一行一条。 */
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 pb-6 lg:grid-cols-2">
          {tracks.map((track, index) => (
            <RankRow
              key={track.key}
              track={track}
              rank={index + 1}
              active={track.key === snapshot?.track?.key}
              onOpen={() => navigate({ kind: 'watch', track })}
              onAuthor={() =>
                navigate({ kind: 'author', name: track.artist, mid: track.up_mid ?? null })
              }
            />
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
