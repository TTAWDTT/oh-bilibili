import { toastDone } from '../../app/notice'
import { reportActionError } from '../../shared/lib/actionError'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import type { FavFolder } from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { PageTitle } from '../../shared/ui/PageTitle'
import { BiliTvLoading } from '../../shared/ui/BiliTvLoading'
import { Icon } from '../../shared/ui/Icon'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'

/**
 * B 站收藏夹。读的是你账号里真实存在的收藏夹，不是本地伪造的歌单。
 *
 * 未登录时明确提示需要登录——收藏夹在 B 站那边，本机没有副本。
 */
export function FavFoldersView() {
  const [folders, setFolders] = useState<FavFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<FavFolder | null>(null)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const playContext = usePlayerStore((state) => state.playContext)

  useEffect(() => {
    let cancelled = false
    void ipc
      .favFolders()
      .then((list) => {
        if (!cancelled) setFolders(list)
      })
      .catch((e) => {
        if (!cancelled) setError(toWireError(e).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!picked) {
      setTracks(null)
      return
    }
    let cancelled = false
    setTracks(null)
    setPage(1)
    setExhausted(false)
    void ipc
      .favTracks(picked.id, 1)
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch(() => {
        if (!cancelled) setTracks([])
      })
    return () => {
      cancelled = true
    }
  }, [picked])

  /** 从当前收藏夹移出一条。成功后从列表里去掉，不用整页刷新。 */
  const removeOne = async (track: Track): Promise<void> => {
    if (!picked) return
    try {
      await ipc.unfavFrom(track.key, picked.id)
      setTracks((prev) => (prev ?? []).filter((t) => t.key !== track.key))
      toastDone('已移出收藏夹')
    } catch (e) {
      reportActionError('移出收藏夹', e)
    }
  }

  /** 加载收藏夹的下一页。B 站每页 40 条。 */
  const loadMore = async (): Promise<void> => {
    if (!picked || loadingMore || exhausted) return
    setLoadingMore(true)
    try {
      const next = await ipc.favTracks(picked.id, page + 1)
      if (next.length === 0) {
        setExhausted(true)
      } else {
        setTracks((prev) => [...(prev ?? []), ...next])
        setPage((p) => p + 1)
      }
    } catch {
      setExhausted(true)
    } finally {
      setLoadingMore(false)
    }
  }

  if (error) {
    return (
      <EmptyState
        icon="alert"
        title="读不到收藏夹"
        detail={error.includes('登录') ? '收藏夹在 B 站账号里，登录后才能读取。' : error}
        action={{ label: '去登录', onClick: () => setAuthOpen(true) }}
      />
    )
  }
  if (folders === null) return <BiliTvLoading label="正在读 B 站收藏夹" />

  if (picked) {
    return (
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          // 离底部还有 600px 就预取下一页，滚动时不会等
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) void loadMore()
        }}
        className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
      >
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="mb-4 flex items-center gap-1 text-[14px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          <Icon name="chevronLeft" size={13} />
          收藏夹
        </button>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-[18px] font-semibold text-[var(--text-1)]" title={picked.title}>
            {picked.title}
            <span className="num ml-2 text-[14px] font-normal text-[var(--text-3)]">
              {picked.count} 个视频
            </span>
          </h2>
          {/* 播放全部：把当前已加载的曲目按顺序塞进队列，从第一首开始放 */}
          <button
            type="button"
            disabled={!tracks || tracks.length === 0}
            onClick={() => {
              if (!tracks || tracks.length === 0) return
              void playContext(
                tracks.map((t) => t.key),
                0,
              )
            }}
            className="t press flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-[13px] text-white disabled:opacity-40"
          >
            <Icon name="play" size={13} />
            播放全部
          </button>
        </div>
        {tracks === null ? (
          <TrackListSkeleton rows={6} />
        ) : tracks.length === 0 ? (
          <EmptyState mascot="hug" icon="biliTv" title="这个收藏夹是空的" detail="去 B 站收几个视频再来。" action={null} />
        ) : (
          <>
            <ContentGrid
              tracks={tracks}
              activeKey={snapshot?.track?.key ?? null}
              playing={snapshot?.phase === 'playing'}
              extraAction={(track) => (
                <button
                  type="button"
                  aria-label={`从收藏夹移出 ${track.title}`}
                  title="从这个收藏夹移出"
                  onClick={() => void removeOne(track)}
                  className="bili-icon-hover text-[var(--text-3)] hover:text-[var(--accent)]"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            />
            <div className="mt-6 flex justify-center">
              {exhausted ? (
                <span className="text-[13px] text-[var(--text-3)]">已经到底了</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="bili-press rounded-[6px] border border-[var(--line)] px-4 py-2 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  {loadingMore ? '加载中…' : '加载更多'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  if (folders.length === 0) {
    return (
      <EmptyState
        mascot="hug"
        icon="biliTv"
        title="还没有收藏夹"
        detail="在 B 站建一个收藏夹，这里就能读到。"
        action={null}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <PageTitle>收藏夹</PageTitle>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => setPicked(folder)}
            className="t flex items-center justify-between gap-3 rounded-[4px] border border-[var(--line)] px-3 py-2 text-left hover:border-[var(--accent)]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-[var(--text-1)]" title={folder.title}>
                {folder.title}
              </span>
              <span className="num block text-[12px] text-[var(--text-3)]">{folder.count} 个视频</span>
            </span>
            <Icon name="chevronRight" size={13} className="shrink-0 text-[var(--text-3)]" />
          </button>
        ))}
      </div>
    </div>
  )
}
