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

/** 封面拼图按夹子缓存，来回切页不用重取。 */
const coverCache = new Map<number, string[]>()

/**
 * B 站收藏夹。读的是你账号里真实存在的收藏夹，不是本地伪造的歌单。
 *
 * 未登录时明确提示需要登录——收藏夹在 B 站那边，本机没有副本。
 */
export function FavFoldersView() {
  const [folders, setFolders] = useState<FavFolder[] | null>(null)
  const [covers, setCovers] = useState<Record<number, string[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<FavFolder | null>(null)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const navigate = useAppStore((state) => state.navigate)
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

  // 收藏夹列表接口不带封面，B 站网页端是逐个夹子再取前几条拼四宫格。
  // 先出灰格子，封面到了再补，不为了等图把整页卡住。
  useEffect(() => {
    if (!folders) return
    let alive = true
    const cached: Record<number, string[]> = {}
    for (const folder of folders) {
      const hit = coverCache.get(folder.id)
      if (hit) cached[folder.id] = hit
    }
    setCovers(cached)
    const queue = folders.filter((f) => f.count > 0 && !coverCache.has(f.id)).map((f) => f.id)
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const list = await ipc.favCovers(id, 4)
          coverCache.set(id, list)
          if (alive) setCovers((prev) => ({ ...prev, [id]: list }))
        } catch {
          // 单个夹子的封面取不到就留灰格子，不影响打开夹子
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
    return () => {
      alive = false
    }
  }, [folders])

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
          {/* 播放全部：把当前已加载的曲目按顺序塞进队列，从第一首开始放。
              空收藏夹里它没有可播的东西，摆一个灰按钮只是噪声。 */}
          {tracks && tracks.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              if (!tracks || tracks.length === 0) return
              void playContext(
                tracks.map((t) => t.key),
                0,
              )
            }}
            className="t press flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-[13px] text-white"
          >
            <Icon name="play" size={13} />
            播放全部
          </button>
          ) : null}
        </div>
        {tracks === null ? (
          <TrackListSkeleton rows={6} />
        ) : tracks.length === 0 ? (
          <EmptyState
            mascot="hug"
            icon="biliTv"
            title="这个收藏夹是空的"
            action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
          />
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
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <PageTitle>收藏夹</PageTitle>
      <section className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
        {folders.map((folder) => {
          const shots = covers[folder.id]
          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => setPicked(folder)}
              className="bili-card bili-card-enter bili-press overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] text-left"
            >
              {/* 和 B 站一样用前四条视频拼 2×2 封面；没有封面的格子留底色 */}
              <span className="grid aspect-[16/10] w-full grid-cols-2 gap-px bg-[var(--ga2)]">
                {Array.from({ length: 4 }, (_, i) => (
                  <span key={i} className="relative block overflow-hidden bg-[var(--ga1)]">
                    {shots?.[i] ? (
                      <img
                        src={shots[i]}
                        alt=""
                        aria-hidden
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </span>
                ))}
              </span>
              <span className="block px-3 py-2">
                <span
                  className="line-clamp-1 text-[14px] font-medium text-[var(--text-1)]"
                  title={folder.title}
                >
                  {folder.title}
                </span>
                <span className="num mt-0.5 block text-[12px] text-[var(--text-3)]">
                  {folder.count} 个视频
                </span>
              </span>
            </button>
          )
        })}
      </section>
    </div>
  )
}
