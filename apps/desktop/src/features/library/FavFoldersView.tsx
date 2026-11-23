import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toastDone, toastWarn } from '../../app/notice'
import { reportActionError } from '../../shared/lib/actionError'
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

/** 每个夹子的页数、筛选、错误与滚动位置：宽窗来回切不重新读。 */
type FolderSnapshot = {
  tracks: Track[] | null
  page: number
  exhausted: boolean
  failed: boolean
  error: string | null
  query: string
  top: number
}

/**
 * B 站收藏夹。读的是你账号里真实存在的收藏夹，不是本地伪造的歌单。
 *
 * 宽窗是目录 + 内容双栏，目录常驻；窄窗先进目录，再进单个夹子，返回还在原处。
 * 未登录时明确提示需要登录——收藏夹在 B 站那边，本机没有副本。
 */
export function FavFoldersView() {
  const [folders, setFolders] = useState<FavFolder[] | null>(null)
  const [covers, setCovers] = useState<Record<number, string[]>>({})
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 切回某个夹子时，等列表渲染出来再落位。 */
  const restoreTop = useRef<number | null>(null)
  const memory = useRef(new Map<number, FolderSnapshot>())
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

  const snapshotOf = (): FolderSnapshot => ({
    tracks,
    page,
    exhausted,
    failed,
    error: trackError,
    query,
    top: scrollRef.current?.scrollTop ?? 0,
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
      if (requestTicket.current === ticket) setTracks(list)
    } catch (e) {
      if (requestTicket.current === ticket) setTrackError(toWireError(e).message)
    }
  }

  const openFolder = (folder: FavFolder): void => {
    if (folder.id === pickedId) return
    if (pickedId !== null) memory.current.set(pickedId, snapshotOf())
    prepTicket.current += 1
    prepBusy.current = false
    setPrep(null)
    setPickedId(folder.id)
    const saved = memory.current.get(folder.id)
    if (saved) {
      setTracks(saved.tracks)
      setPage(saved.page)
      setExhausted(saved.exhausted)
      setFailed(saved.failed)
      setTrackError(saved.error)
      setQuery(saved.query)
      restoreTop.current = saved.top
      return
    }
    restoreTop.current = null
    void startFirstPage(folder.id)
  }

  const closeFolder = (): void => {
    if (pickedId !== null) memory.current.set(pickedId, snapshotOf())
    prepTicket.current += 1
    prepBusy.current = false
    setPrep(null)
    setPickedId(null)
  }

  // 宽窗进页时直接选第一个夹子；窄窗仍从目录开始。
  const openRef = useRef(openFolder)
  openRef.current = openFolder
  useEffect(() => {
    if (!wide || pickedId !== null || !folders || folders.length === 0) return
    openRef.current(folders[0]!)
  }, [wide, folders, pickedId])

  useLayoutEffect(() => {
    if (restoreTop.current === null || !scrollRef.current) return
    scrollRef.current.scrollTop = restoreTop.current
    restoreTop.current = null
  }, [pickedId, tracks])

  /** 加载收藏夹的下一页。B 站每页 40 条。 */
  const loadMore = async (force = false): Promise<void> => {
    if (!picked || busy.current || exhausted || (failed && !force)) return
    const ticket = requestTicket.current
    busy.current = true
    setLoadingMore(true)
    setFailed(false)
    try {
      const next = await ipc.favTracks(picked.id, page + 1)
      if (requestTicket.current !== ticket) return
      if (next.length === 0) {
        setExhausted(true)
      } else {
        // 页间重复或整页都已见过的作品，按到底处理，避免列表无限变长。
        const prev = tracks ?? []
        const seen = new Set(prev.map((track) => track.key))
        const fresh = next.filter((track) => !seen.has(track.key))
        if (fresh.length === 0) {
          setExhausted(true)
        } else {
          setTracks([...prev, ...fresh])
          setPage((p) => p + 1)
        }
      }
    } catch {
      if (requestTicket.current === ticket) setFailed(true)
    } finally {
      busy.current = false
      setLoadingMore(false)
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
    if (!picked || prepBusy.current) return
    prepBusy.current = true
    const ticket = ++prepTicket.current
    setPrep({ loaded: tracks?.length ?? 0, page: 1 })
    try {
      const { tracks: all, complete } = await collectFavTracks(
        (nextPage) => ipc.favTracks(picked.id, nextPage),
        {
          // 已翻过的页直接沿用当前列表，只补后面的。
          initial: tracks ?? [],
          fromPage: tracks && tracks.length > 0 ? page + 1 : 1,
          expected: picked.count,
          stopped: () => prepTicket.current !== ticket,
          onProgress: (loaded, nextPage) => {
            if (prepTicket.current === ticket) setPrep({ loaded, page: nextPage })
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

  const header = picked ? (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      {!wide ? (
        <button
          type="button"
          onClick={closeFolder}
          className="flex items-center gap-1 text-[13px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          <Icon name="chevronLeft" size={13} />
          收藏夹
        </button>
      ) : null}
      <h2 className="min-w-0 truncate text-[18px] font-semibold text-[var(--text-1)]" title={picked.title}>
        {picked.title}
      </h2>
      <span className="num shrink-0 text-[12.5px] text-[var(--text-3)]">{picked.count} 个视频</span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <label className="flex h-8 w-[180px] items-center gap-1.5 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-2 focus-within:border-[var(--accent)]">
          <Icon name="search" size={13} className="shrink-0 text-[var(--text-3)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="在这夹里搜索"
            aria-label="在已加载的收藏里搜索"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
          />
        </label>
        {prep ? (
          <span className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--text-3)]">
            <span className="num">
              已读 {prep.loaded} · 第 {prep.page} 页
            </span>
            <button type="button" onClick={cancelPrep} className="t text-[var(--accent)] hover:underline">
              取消
            </button>
          </span>
        ) : tracks && tracks.length > 0 ? (
          <button
            type="button"
            onClick={() => void playAll()}
            className="t press flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-3 text-[12.5px] text-white"
          >
            <Icon name="play" size={12} />
            播放全部
          </button>
        ) : null}
      </div>
    </div>
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
          title="这个收藏夹是空的"
          action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
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
  ) : (
    <p className="py-10 text-center text-[13px] text-[var(--text-3)]">选择一个收藏夹。</p>
  )

  if (wide) {
    return (
      <div className="flex min-h-0 flex-1">
        <aside aria-label="收藏夹目录" className="flex w-[216px] shrink-0 flex-col border-r border-hairline">
          <div className="px-4 pb-2 pt-5">
            <h2 className="text-[20px] font-semibold leading-[28px] text-[var(--text-1)]">收藏夹</h2>
            <p className="num mt-0.5 text-[12.5px] text-[var(--text-3)]">{folders.length} 个</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
            {folders.map((folder) => {
              const on = folder.id === pickedId
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => openFolder(folder)}
                  aria-current={on ? 'true' : undefined}
                  className={[
                    't press mb-0.5 block w-full rounded-[6px] px-2.5 py-2 text-left',
                    on
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-1)] hover:bg-[var(--panel-alt)]',
                  ].join(' ')}
                >
                  <span className="line-clamp-2 text-[13.5px] leading-[19px]">{folder.title}</span>
                  <span className="num mt-0.5 block text-[11.5px] text-[var(--text-3)]">
                    {folder.count} 个视频
                  </span>
                </button>
              )
            })}
          </div>
        </aside>
        <section ref={scrollRef} id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {content}
        </section>
      </div>
    )
  }

  if (picked) {
    return (
      <div
        ref={scrollRef}
        id="scroll-main"
        className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
      >
        {content}
      </div>
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
              onClick={() => openFolder(folder)}
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
                  Array.from({ length: 4 }, (_, i) => <span key={i} className="block bg-[var(--ga1)]" />)
                )}
              </span>
              <span className="block px-3 py-2">
                <span className="line-clamp-1 text-[14px] font-medium text-[var(--text-1)]" title={folder.title}>
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
