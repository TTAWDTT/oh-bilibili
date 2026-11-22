import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { usePlayerStore } from '../player/playerStore'
import { PARTS } from '../../shared/lib/biliParts'
import { useAppStore } from '../../app/appStore'
import { HotTabs } from './HotTabs'

/** 按分区记住读到哪：从视频返回同一分区时回到原位置，换分区从第一名开始。 */
const rankMemory: { rid: number; top: number } = { rid: -1, top: 0 }

/** 名次颜色：前三名留一点颜色，其余交给正文灰，数字本身先要清楚。 */
function rankColor(rank: number): string {
  if (rank === 1) return 'var(--accent)'
  if (rank === 2) return '#e8853a'
  if (rank === 3) return '#c2952a'
  return 'var(--text-2)'
}

/**
 * 榜单的一行：名次独立成列，竖向对齐成一整条；封面、标题、统计依次向右。
 * 第一名把封面与标题放大一档，但名次仍与下面同一条线。
 */
function RankRow({ track, rank, active, onOpen, onAuthor }: {
  track: Track
  rank: number
  active: boolean
  onOpen: () => void
  onAuthor: () => void
}) {
  const top = rank <= 3
  const first = rank === 1
  return (
    <div
      data-rank-row
      data-rank={rank}
      className="group grid grid-cols-[2rem_auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 sm:grid-cols-[2.75rem_auto_minmax(0,1fr)_auto] sm:gap-x-4"
    >
      <span
        className={`num pt-1 text-right font-mono font-semibold tabular-nums ${
          first ? 'text-[26px] leading-[30px]' : top ? 'text-[21px] leading-[26px]' : 'text-[16px] leading-[22px]'
        }`}
        style={{ color: rankColor(rank) }}
      >
        {rank}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className={`relative w-[7rem] shrink-0 ${first ? 'sm:w-[13.5rem]' : 'sm:w-[10.5rem]'}`}
        title={track.title}
      >
        <span className="relative block aspect-video overflow-hidden rounded-[6px]">
          <Cover cover={track.cover} title={track.title} width={216} className="h-full w-full" />
          <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/60 px-1 text-[11px] leading-[16px] text-white">
            {formatDuration(track.duration_ms)}
          </span>
        </span>
      </button>
      <div className="min-w-0 py-0.5">
        <button
          type="button"
          onClick={onOpen}
          title={track.title}
          className={`line-clamp-2 block w-full text-left font-medium hover:text-[var(--accent)] ${
            first ? 'text-[17px] leading-[24px] sm:text-[18px] sm:leading-[26px]' : 'text-[15px] leading-[22px]'
          } ${
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
        {/* 窄窗把统计挪到标题下面，先保住名次、标题和封面的宽度。 */}
        <span className="num mt-1 flex items-center gap-3 text-[12px] text-[var(--text-3)] sm:hidden">
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
      </div>
      <span className="num hidden shrink-0 items-center gap-4 pt-1 text-[12px] text-[var(--text-3)] sm:flex">
        {track.views ? (
          <span className="flex w-16 items-center justify-end gap-1">
            <Icon name="play" size={11} />
            {formatCount(track.views)}
          </span>
        ) : (
          <span className="w-16" />
        )}
        {(track.danmaku ?? 0) > 0 ? (
          <span className="flex w-14 items-center justify-end gap-1">
            <Icon name="danmaku" size={11} />
            {formatCount(track.danmaku!)}
          </span>
        ) : (
          <span className="w-14" />
        )}
      </span>
    </div>
  )
}

/**
 * 排行榜。读的是 B 站公开榜单，一次 100 条；名次就是接口返回的顺序。
 * 名次单独成列、自上而下排成一张榜，前三名用一点颜色。
 */
export function RankingView({ initialRid = 0 }: { initialRid?: number }) {
  const [rid, setRid] = useState(initialRid)
  const replace = useAppStore((s) => s.replace)
  const navigate = useAppStore((s) => s.navigate)
  const [nonce, setNonce] = useState(0)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const restorePending = useRef(false)
  const snapshot = usePlayerStore((state) => state.snapshot)

  useEffect(() => {
    let cancelled = false
    // 换分区就是换一份榜；同一分区从视频返回则回到原来的名次附近。
    const box = scrollRef.current
    const same = rankMemory.rid === rid
    if (!same) rankMemory.top = 0
    if (box) box.scrollTop = same ? rankMemory.top : 0
    rankMemory.rid = rid
    // 列表还没回来时容器只有 loader，先记下，等这一份榜渲染出来再落位。
    restorePending.current = same && rankMemory.top > 0
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

  useEffect(() => {
    if (!restorePending.current || tracks === null) return
    restorePending.current = false
    if (scrollRef.current) scrollRef.current.scrollTop = rankMemory.top
  }, [tracks])

  return (
    <div
      ref={scrollRef}
      id="scroll-main"
      onScroll={(event) => {
        rankMemory.rid = rid
        rankMemory.top = event.currentTarget.scrollTop
      }}
      className="min-h-0 flex-1 overflow-y-auto pb-10"
    >
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
        <BiliLoader label="正在取榜单…" />
      ) : tracks.length === 0 ? (
        <EmptyState mascot="missYou" icon="biliTv" title="这个分区今天没有榜单" action={null} />
      ) : (
        /* 单列纵排：名次是独立一列，纵向扫读第 37 名时不用在两列之间找。 */
        <div className="flex flex-col gap-5 pb-6">
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
