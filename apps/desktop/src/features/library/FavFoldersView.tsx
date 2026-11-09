import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import type { FavFolder } from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { TrackGrid } from '../tracks/TrackGrid'
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
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const snapshot = usePlayerStore((state) => state.snapshot)

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
  if (folders === null) return <TrackListSkeleton rows={6} />

  if (picked) {
    return (
      <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-6">
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="mb-4 flex items-center gap-1 text-[14px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          <Icon name="chevronLeft" size={13} />
          收藏夹
        </button>
        <h1 className="mb-4 truncate text-[18px] font-semibold text-[var(--text-1)]" title={picked.title}>
          {picked.title}
          <span className="num ml-2 text-[14px] font-normal text-[var(--text-3)]">
            {picked.count} 个视频
          </span>
        </h1>
        {tracks === null ? (
          <TrackListSkeleton rows={6} />
        ) : tracks.length === 0 ? (
          <EmptyState icon="biliTv" title="这个收藏夹是空的" detail="去 B 站收几个视频再来。" action={null} />
        ) : (
          <>
            <TrackGrid
              tracks={tracks}
              activeKey={snapshot?.track?.key ?? null}
              playing={snapshot?.phase === 'playing'}
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
        icon="biliTv"
        title="还没有收藏夹"
        detail="在 B 站建一个收藏夹，这里就能读到。"
        action={null}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-6">
      <h1 className="mb-4 text-[18px] font-semibold text-[var(--text-1)]">B 站收藏夹</h1>
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
