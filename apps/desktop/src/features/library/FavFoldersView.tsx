import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toastDone, toastWarn } from '../../app/notice'
import { reportActionError } from '../../shared/lib/actionError'
import { useAppStore, type View } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import type { FavFolder } from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { appendFavPage, collectFavTracks } from './favPages'
import { FavoriteDirectory, FolderCover } from './FavoriteDirectory'
import './favorite-page.css'

/** 每个夹子的页数、筛选、错误与滚动位置：宽窗来回切不重新读。 */
type FolderSnapshot = {
  tracks: Track[] | null
  page: number
  exhausted: boolean
  failed: boolean
  error: string | null
  query: string
  top: number
  lastRenderedIndex: number
}

const visits = new WeakMap<View, {
  pickedId: number | null
  folders: Map<number, FolderSnapshot>
  directoryTop: number
}>()

/**
 * B 站收藏夹。读的是你账号里真实存在的收藏夹，不是本地伪造的歌单。
 *
 * 宽窗直接翻看夹内视频；窄窗先进目录，返回时保留原来的夹子和滚动位置。
 * 未登录时明确提示需要登录——收藏夹在 B 站那边，本机没有副本。
 */
export function FavFoldersView() {
  const visit = useRef(useAppStore.getState().view).current
  const savedVisit = visits.get(visit)
  const [folders, setFolders] = useState<FavFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickedId, setPickedId] = useState<number | null>(null)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [trackError, setTrackError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  /** 翻页失败只是这一页没取到，不是到底；给一个原地重试。 */
  const [failed, setFailed] = useState(false)
  /** 夹内搜索只覆盖已加载的部分，范围会写在结果上方。 */
  const [query, setQuery] = useState('')
  /** 「播放全部」先补齐所有页；准备期间只显示进度和取消。 */
  const [prep, setPrep] = useState<{ loaded: number; page: number } | null>(null)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const busy = useRef(false)
  /** 连点「播放全部」时靠它挡住第二次，状态更新来不及。 */
  const prepBusy = useRef(false)
  const prepTicket = useRef(0)
  const requestTicket = useRef(0)
  const scrollRef = useRef<HTMLElement>(null)
  const directoryRef = useRef<HTMLDivElement>(null)
  const directoryTop = useRef(savedVisit?.directoryTop ?? 0)
  const returnFolderId = useRef<number | null>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  /** 切回某个夹子时，等列表渲染出来再落位。 */
  const restoreTop = useRef<number | null>(null)
  const memory = useRef(savedVisit?.folders ?? new Map<number, FolderSnapshot>())
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const navigate = useAppStore((state) => state.navigate)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const playContext = usePlayerStore((state) => state.playContext)

  const picked = folders?.find((folder) => folder.id === pickedId) ?? null

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (event: MediaQueryListEvent): void => setWide(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

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

  const snapshotOf = (): FolderSnapshot => ({
    tracks,
    page,
    exhausted,
    failed,
    error: trackError,
    query,
    top: scrollRef.current?.scrollTop ?? 0,
    lastRenderedIndex: Number(scrollRef.current?.querySelector<HTMLElement>('[data-shown]')?.dataset.shown ?? 1) - 1,
  })

  /** 第一页。失败单独记，不能当成空夹。 */
  const startFirstPage = async (id: number): Promise<void> => {
    const ticket = ++requestTicket.current
    setTracks(null)
    setTrackError(null)
    setPage(1)
    setExhausted(false)
    setFailed(false)
    setQuery('')
    try {
      const list = await ipc.favTracks(id, 1)
      if (requestTicket.current === ticket) {
        setTracks(appendFavPage([], list.tracks))
        setExhausted(!list.has_more)
      }
    } catch (e) {
      if (requestTicket.current === ticket) setTrackError(toWireError(e).message)
    }
  }

  const openFolder = (folder: FavFolder): void => {
    if (folder.id === pickedId) return
    if (pickedId !== null) memory.current.set(pickedId, snapshotOf())
    requestTicket.current += 1
    busy.current = false
    setLoadingMore(false)
    prepTicket.current += 1
    prepBusy.current = false
    setPrep(null)
    setPickedId(folder.id)
    const saved = memory.current.get(folder.id)
    if (saved && (saved.tracks !== null || saved.error)) {
      setTracks(saved.tracks)
      setPage(saved.page)
      setExhausted(saved.exhausted)
      setFailed(saved.failed)
      setTrackError(saved.error)
      setQuery(saved.query)
      restoreTop.current = saved.top
      return
    }
    restoreTop.current = 0
    void startFirstPage(folder.id)
  }

  const closeFolder = (): void => {
    if (pickedId !== null) memory.current.set(pickedId, snapshotOf())
    requestTicket.current += 1
    busy.current = false
    setLoadingMore(false)
    prepTicket.current += 1
    prepBusy.current = false
    setPrep(null)
    returnFolderId.current = pickedId
    setPickedId(null)
  }

  // 宽窗进页时直接选第一个夹子；窄窗仍从目录开始。
  const openRef = useRef(openFolder)
  openRef.current = openFolder
  useEffect(() => {
    if (pickedId !== null || !folders?.length) return
    const saved = visits.get(visit)
    if (saved) visits.delete(visit)
    const folder = folders.find((item) => item.id === saved?.pickedId) ?? (wide ? folders[0] : null)
    if (folder) openRef.current(folder)
  }, [wide, folders, pickedId, visit])

  const saveVisit = useRef(() => {})
  saveVisit.current = () => {
    if (pickedId !== null) memory.current.set(pickedId, snapshotOf())
    visits.set(visit, { pickedId, folders: memory.current, directoryTop: directoryTop.current })
  }
  useLayoutEffect(() => {
    // 切到观看页会收起侧栏。等卸载时再量，旧网格已经换宽，存下的位置会偏一排。
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (previous.view === visit && next.view !== visit) saveVisit.current()
    })
    return () => {
      unsubscribe()
      prepTicket.current += 1
      requestTicket.current += 1
    }
  }, [visit])

  useLayoutEffect(() => {
    if (pickedId !== null) {
      backRef.current?.focus({ preventScroll: true })
    } else if (returnFolderId.current !== null && directoryRef.current) {
      directoryRef.current.scrollTop = directoryTop.current
      const button = directoryRef.current.querySelector<HTMLElement>(`[data-fav-folder="${returnFolderId.current}"]`)
      button?.focus({ preventScroll: true })
      button?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      returnFolderId.current = null
    }
  }, [pickedId])

  useLayoutEffect(() => {
    if (restoreTop.current === null || !scrollRef.current) return
    scrollRef.current.scrollTop = restoreTop.current
    restoreTop.current = null
  }, [pickedId, tracks])

  /** 加载收藏夹的下一页。B 站每页 40 条。 */
  const loadMore = async (force = false): Promise<void> => {
    if (!picked || busy.current || prepBusy.current || exhausted || (failed && !force)) return
    const ticket = requestTicket.current
    busy.current = true
    setLoadingMore(true)
    setFailed(false)
    try {
      const next = await ipc.favTracks(picked.id, page + 1)
      if (requestTicket.current !== ticket) return
      const previous = tracks ?? []
      const merged = appendFavPage(previous, next.tracks)
      if (next.has_more && next.tracks.length > 0 && merged.length === previous.length) {
        setFailed(true)
        return
      }
      setTracks(merged)
      setPage(page + 1)
      setExhausted(!next.has_more)
    } catch {
      if (requestTicket.current === ticket) setFailed(true)
    } finally {
      if (requestTicket.current === ticket) {
        busy.current = false
        setLoadingMore(false)
      }
    }
  }

  /** 从当前收藏夹移出一条。成功后从列表与目录数量里一起减掉。 */
  const removeOne = async (track: Track): Promise<void> => {
    if (!picked) return
    try {
      await ipc.unfavFrom(track.key, picked.id)
      setTracks((prev) => (prev ?? []).filter((t) => t.key !== track.key))
      const nextCount = Math.max(0, picked.count - 1)
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
    if (!picked || !tracks || busy.current || prepBusy.current) return
    prepBusy.current = true
    const ticket = ++prepTicket.current
    setPrep({ loaded: tracks.length, page })
    try {
      const result = exhausted ? { tracks, complete: true } : await collectFavTracks(
        (nextPage) => ipc.favTracks(picked.id, nextPage),
        {
          initial: tracks,
          fromPage: page + 1,
          stopped: () => prepTicket.current !== ticket,
          onProgress: (loaded, nextPage, complete) => {
            setTracks(loaded)
            setPage(nextPage)
            setExhausted(complete)
            setPrep({ loaded: loaded.length, page: nextPage })
          },
        },
      )
      if (prepTicket.current !== ticket) return
      const all = result.tracks
      if (!result.complete) {
        toastWarn('收藏夹分页没有继续', `已读 ${all.length} 个可播视频，原队列已保留`)
        return
      }
      if (all.length === 0) {
        toastDone('这个收藏夹里没有可播放的视频')
        return
      }
      await playContext(
        all.map((t) => t.key),
        0,
      )
      if (all.length !== picked.count) toastDone(`已播放夹内 ${all.length} 个可播视频`)
    } catch {
      if (prepTicket.current === ticket) {
        toastWarn('没能读全这个收藏夹', '这次没有开始播放，稍后再试')
      }
    } finally {
      if (prepTicket.current === ticket) {
        prepBusy.current = false
        setPrep(null)
      }
    }
  }

  const cancelPrep = (): void => {
    prepTicket.current += 1
    prepBusy.current = false
    setPrep(null)
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

  const needle = query.trim().toLowerCase()
  const visible = (tracks ?? []).filter(
    (track) => !needle || `${track.title} ${track.artist}`.toLowerCase().includes(needle),
  )

  const single = wide && folders.length === 1
  const header = picked ? (
    <header className="favorite-heading">
      {!wide && (
        <button ref={backRef} type="button" onClick={closeFolder} aria-label="返回收藏夹目录" className="favorite-back">
          <Icon name="chevronLeft" size={15} />
          收藏夹
        </button>
      )}
      <div className="favorite-heading-row">
        <div className="favorite-heading-title">
          {single && <span className="favorite-single-cover"><FolderCover folder={picked} /></span>}
          <h2>{picked.title}</h2>
          <span className="favorite-video-count num">{picked.count} 个视频</span>
        </div>
        <div className="favorite-tools">
          <label className="favorite-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索已加载的视频"
              aria-label="在已加载的收藏里搜索"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </label>
          {prep ? (
            <span className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
              <span className="num">
                已读 {prep.loaded} · 第 {prep.page} 页
              </span>
              <button type="button" onClick={cancelPrep} className="t text-[var(--accent)] hover:underline">
                取消
              </button>
            </span>
          ) : tracks && (tracks.length > 0 || !exhausted) ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void playAll()}
              className="t press flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--accent-strong)] px-3 text-[12.5px] text-white"
            >
              <Icon name="play" size={12} />
              播放全部
            </button>
          ) : null}
        </div>
      </div>
    </header>
  ) : null

  const content = picked ? (
    <>
      {header}
      {needle ? (
        <p className="mb-2 text-[12px] text-[var(--text-3)]">
          在已加载的 {tracks?.length ?? 0} 项里搜到 {visible.length} 项
        </p>
      ) : null}
      {trackError ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <p className="text-[13px] text-[var(--text-3)]">{trackError}</p>
          <button
            type="button"
            onClick={() => void startFirstPage(picked.id)}
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
          title={exhausted ? (picked.count > 0 ? '没有可播放的视频' : '这个收藏夹是空的') : '本页没有可播放的视频'}
          action={exhausted ? null : { label: '加载下一页', onClick: () => void loadMore(true) }}
        />
      ) : visible.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-10 text-[13px] text-[var(--text-3)]">
          已加载的收藏里没有匹配的。
          <button type="button" onClick={() => setQuery('')} className="t text-[var(--accent)]">
            清除搜索
          </button>
        </div>
      ) : (
        <>
          <ContentGrid
            key={picked.id}
            initialIndex={memory.current.get(picked.id)?.lastRenderedIndex ?? 0}
            tracks={visible}
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
    </>
  ) : null

  return (
    <div className="favorite-page flex min-h-0 flex-1 flex-col">
      {!single && (
        <div ref={directoryRef} hidden={!wide && !!picked} id={!wide && !picked ? 'scroll-main' : undefined}
          className="favorite-directory-pane">
          <div className="favorite-page-inner">
            <FavoriteDirectory folders={folders} pickedId={pickedId} compact={wide} onPick={(folder) => {
              if (!wide) directoryTop.current = directoryRef.current?.scrollTop ?? 0
              openFolder(folder)
            }} />
          </div>
        </div>
      )}
      {picked && (
        <section ref={scrollRef} id="scroll-main" aria-label="夹内视频" className="favorite-videos min-h-0 flex-1 overflow-y-auto">
          <div className="favorite-page-inner">{content}</div>
        </section>
      )}
    </div>
  )
}
