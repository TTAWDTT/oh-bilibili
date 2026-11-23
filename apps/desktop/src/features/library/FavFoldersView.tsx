import { toastDone, toastWarn } from '../../app/notice'
import { reportActionError } from '../../shared/lib/actionError'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import type { FavFolder } from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { thumbWide } from '../../shared/lib/thumb'
import { PageTitle } from '../../shared/ui/PageTitle'
import { Icon } from '../../shared/ui/Icon'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { collectFavTracks } from './favPages'

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
  /** 翻页失败只是这一页没取到，不是到底；给一个原地重试。 */
  const [failed, setFailed] = useState(false)
  /** 第一页没取到要能和空收藏夹区分开，否则会显示「这个收藏夹是空的」。 */
  const [trackError, setTrackError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  /** 「播放全部」先补齐所有页；准备期间只显示进度和取消。 */
  const [prep, setPrep] = useState<{ loaded: number; page: number } | null>(null)
  const prepTicket = useRef(0)
  const busy = useRef(false)
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

  const folderId = picked?.id ?? null
  useEffect(() => {
    prepTicket.current += 1
    setPrep(null)
    if (folderId === null) {
      setTracks(null)
      setTrackError(null)
      return
    }
    let cancelled = false
    setTracks(null)
    setTrackError(null)
    setPage(1)
    setExhausted(false)
    setFailed(false)
    void ipc
      .favTracks(folderId, 1)
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch((e) => {
        if (!cancelled) setTrackError(toWireError(e).message)
      })
    return () => {
      cancelled = true
    }
  }, [folderId, reload])

  /** 从当前收藏夹移出一条。成功后从列表里去掉，不用整页刷新。 */
  const removeOne = async (track: Track): Promise<void> => {
    if (!picked) return
    try {
      await ipc.unfavFrom(track.key, picked.id)
      setTracks((prev) => (prev ?? []).filter((t) => t.key !== track.key))
      const nextCount = Math.max(0, picked.count - 1)
      setPicked({ ...picked, count: nextCount })
      setFolders((prev) => (prev ?? []).map((f) => (f.id === picked.id ? { ...f, count: nextCount } : f)))
      toastDone('已移出收藏夹')
    } catch (e) {
      reportActionError('移出收藏夹', e)
    }
  }

  /**
   * 播放全部：先把收藏夹的每一页读完，确认范围后再一次提交队列。
   * 中途失败、取消或切夹都不改动正在播放的队列。
   */
  const playAll = async (): Promise<void> => {
    if (!picked || prep !== null) return
    const ticket = ++prepTicket.current
    setPrep({ loaded: tracks?.length ?? 0, page: 1 })
    try {
      const { tracks: all, complete } = await collectFavTracks(
        (page) => ipc.favTracks(picked.id, page),
        {
          expected: picked.count,
          stopped: () => prepTicket.current !== ticket,
          onProgress: (loaded, page) => {
            if (prepTicket.current === ticket) setPrep({ loaded, page })
          },
        },
      )
      if (prepTicket.current !== ticket) return
      if (all.length === 0) {
        toastDone('这个收藏夹里没有可播放的视频')
        return
      }
      await playContext(
        all.map((t) => t.key),
        0,
      )
      if (!complete) {
        toastWarn(`按读到的 ${all.length} 项播放`, '收藏夹数量可能过期，没读到的项没有排进队列')
      }
    } catch {
      if (prepTicket.current === ticket) {
        toastWarn('没能读全这个收藏夹', '这次没有开始播放，稍后再试')
      }
    } finally {
      if (prepTicket.current === ticket) setPrep(null)
    }
  }

  const cancelPrep = (): void => {
    prepTicket.current += 1
    setPrep(null)
  }

  /** 加载收藏夹的下一页。B 站每页 40 条。 */
  const loadMore = async (force = false): Promise<void> => {
    if (!picked || busy.current || exhausted || (failed && !force)) return
    busy.current = true
    setLoadingMore(true)
    setFailed(false)
    try {
      const next = await ipc.favTracks(picked.id, page + 1)
      if (next.length === 0) {
        setExhausted(true)
      } else {
        setTracks((prev) => [...(prev ?? []), ...next])
        setPage((p) => p + 1)
      }
    } catch {
      setFailed(true)
    } finally {
      busy.current = false
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
  if (folders === null) return <BiliLoader label="正在读 B 站收藏夹…" />

  if (picked) {
    return (
      <div
        ref={scrollRef}
        id="scroll-main"
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
          {/* 播放全部要先把所有页读完，准备期间只显示进度和取消。 */}
          {prep ? (
            <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-[var(--text-3)]">
              <span className="num">
                已读 {prep.loaded} 项 · 第 {prep.page} 页
              </span>
              <button type="button" onClick={cancelPrep} className="t text-[var(--accent)] hover:underline">
                取消
              </button>
            </span>
          ) : tracks && tracks.length > 0 ? (
            <button
              type="button"
              onClick={() => void playAll()}
              className="t press flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-[13px] text-white"
            >
              <Icon name="play" size={13} />
              播放全部
            </button>
          ) : null}
        </div>
        {trackError ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <p className="text-[13px] text-[var(--text-3)]">{trackError}</p>
            <button
              type="button"
              onClick={() => setReload((n) => n + 1)}
              className="t press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[12.5px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              重试
            </button>
          </div>
        ) : tracks === null ? (
          <BiliLoader label="正在取收藏夹…" />
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
              onNeedMore={() => void loadMore()}
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
              ) : failed ? (
                <button
                  type="button"
                  onClick={() => void loadMore(true)}
                  className="t press text-[13px] text-[var(--accent)] hover:underline"
                >
                  没加载出来，重试这一页
                </button>
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
    <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <PageTitle extra={`${folders.length} 个`}>收藏夹</PageTitle>
      <section className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
        {folders.map((folder) => {
          const shots = covers[folder.id]
          const single = shots?.[0] ?? folder.cover
          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => setPicked(folder)}
              className="bili-card bili-card-enter bili-press overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] text-left"
            >
              {/* 列表接口自带一张封面，先铺上；四张拼图到了再换成 2×2。 */}
              <span className="relative grid aspect-[16/10] w-full grid-cols-2 grid-rows-2 gap-px overflow-hidden bg-[var(--ga2)]">
                {shots && shots.length >= 4 ? (
                  shots.slice(0, 4).map((src, i) => (
                    <span key={i} className="relative block overflow-hidden bg-[var(--ga1)]">
                      <img
                        src={thumbWide(src, 400) ?? src}
                        alt=""
                        aria-hidden
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </span>
                  ))
                ) : single ? (
                  <img
                    src={thumbWide(single, 800) ?? single}
                    alt=""
                    aria-hidden
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="col-span-2 row-span-2 h-full w-full object-cover"
                  />
                ) : (
                  Array.from({ length: 4 }, (_, i) => (
                    <span key={i} className="block bg-[var(--ga1)]" />
                  ))
                )}
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
