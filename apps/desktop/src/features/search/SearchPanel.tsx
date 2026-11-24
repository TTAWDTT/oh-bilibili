import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { toastDone } from '../../app/notice'
import type { Track, WireError } from '../../shared/lib/contract'
import type { HotSearchItem } from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { formatCount } from '../../shared/lib/format'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { usePlayerStore } from '../player/playerStore'
import { useAuthStore } from '../auth/authStore'
import { ContentGrid } from '../tracks/ContentGrid'
import { PARTITIONS, PartitionFilter } from './PartitionFilter'
import { DURATION_OPTIONS, DurationFilter } from './DurationFilter'
import { useSearchHistory } from '../../shared/lib/searchHistory'
import './search.css'

const ORDERS = [
  ['totalrank', '综合排序'], ['click', '最多播放'], ['pubdate', '最新发布'], ['danmaku', '最多弹幕'],
] as const
const SUGGESTIONS = ['晴天', '周深', '纯音乐', '夜空中最亮的星', '起风了']

type Status = 'idle' | 'loading' | 'ready' | 'error'

type SearchTab = 'all' | 'video' | 'user'
type SearchMemory = {
  key: string
  tracks: Track[]
  users: ipc.UserHit[]
  page: number
  ended: boolean
  usersPage: number
  usersEnded: boolean
  tab: SearchTab
  filtersOpen: boolean
  scrollTop: number
  lastRenderedIndex: number
}

/** 搜索结果按查询条件缓存：从视频页返回时不该重新搜一遍，也不该跳回顶部。 */
let searchMemory: SearchMemory | null = null

function searchKey(query: string, partition: string, order: string, duration: number): string {
  return [query, partition, order, duration].join('\u0000')
}

export function SearchPanel({ query }: { query: string }) {
  const partition = useAppStore((state) => state.currentPartition)
  const order = useAppStore((state) => state.currentOrder)
  const duration = useAppStore((state) => state.currentDuration)

  const bootKey = searchKey(query.trim(), partition, order, duration)
  const restoreRef = useRef<SearchMemory | null | undefined>(undefined)
  if (restoreRef.current === undefined) {
    restoreRef.current =
      searchMemory?.key === bootKey ? searchMemory : null
  }
  const restored = restoreRef.current
  const [page, setPage] = useState(restored?.page ?? 1)
  const [tracks, setTracks] = useState<Track[]>(restored?.tracks ?? [])
  const [users, setUsers] = useState<ipc.UserHit[]>(restored?.users ?? [])
  const [usersScope, setUsersScope] = useState(
    restored?.users.length ? [query.trim(), partition].join('\u0000') : '',
  )
  const [usersPage, setUsersPage] = useState(restored?.usersPage ?? 1)
  const [usersEnded, setUsersEnded] = useState(restored?.usersEnded ?? false)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersMoreError, setUsersMoreError] = useState(false)
  const [usersError, setUsersError] = useState(false)
  const [dataKey, setDataKey] = useState(restored?.key ?? '')
  const [status, setStatus] = useState<Status>(restored ? 'ready' : 'idle')
  const loaded = useRef({ key: restored?.key ?? '', page: restored?.page ?? 0 })
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  /** 这一批 UP 主里已经点过关注的人。只单向关注，不提供取关，避免误触。 */
  const [followedMids, setFollowedMids] = useState<ReadonlySet<number>>(new Set())
  const loggedIn = useAuthStore((state) => state.auth?.logged_in ?? false)
  /** 结果已经翻到头。ref 不能触发渲染，底部要据此换掉「继续下滑查看更多」。 */
  const [ended, setEnded] = useState(restored?.ended ?? false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [nonce, setNonce] = useState(0)
  const [usersNonce, setUsersNonce] = useState(0)
  /** B 站搜索页的结果分类。默认综合，视频与 UP 主分开看。 */
  const [tab, setTab] = useState<SearchTab>(restored?.tab ?? 'all')
  const [filtersOpen, setFiltersOpen] = useState(restored?.filtersOpen ?? false)
  const activeFilters = [
    partition !== '全部' && partition,
    order !== 'totalrank' && ORDERS.find(([value]) => value === order)?.[1],
    duration !== 0 && DURATION_OPTIONS.find(({ key }) => key === duration)?.label,
  ].filter(Boolean)
  const navigate = useAppStore((state) => state.navigate)
  const history = useSearchHistory((s) => s.items)
  /** 热搜榜。取不到就退回内置建议，给空结果提供可点的替代词。 */
  const [hotWords, setHotWords] = useState<HotSearchItem[]>([])
  useEffect(() => {
    let cancelled = false
    void ipc
      .hotSearch()
      .then((list) => {
        if (!cancelled) setHotWords(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const trending: HotSearchItem[] =
    hotWords.length > 0
      ? hotWords
      : SUGGESTIONS.map((s) => ({ keyword: s, label: s, icon: '', heat: 0 }))
  const selectedPartition = PARTITIONS.find((p) => p.label === partition) ?? PARTITIONS[0]!
  const pushHistory = useSearchHistory((s) => s.push)
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)
  const setSearchFilters = useAppStore((state) => state.setSearchFilters)
  const goBack = useAppStore((state) => state.goBack)
  const [error, setError] = useState<WireError | null>(null)
  const seq = useRef(0)
  const usersSeq = useRef(0)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const trimmed = query.trim()
  const userScope = [trimmed, partition].join('\u0000')
  const usersReady = usersScope === userScope
  const loadFollowed = useCallback((list: ipc.UserHit[]): void => {
    if (list.length === 0) return
    void ipc
      .relationFollowedMany(list.map((u) => u.mid))
      .then((rows) => {
        setFollowedMids(
          (prev) => new Set([...prev, ...rows.filter(([, on]) => on).map(([mid]) => mid)]),
        )
      })
      .catch(() => {})
  }, [])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (restored) el.scrollTop = restored.scrollTop
    return () => {
      if (!searchMemory) return
      searchMemory.scrollTop = el.scrollTop
      searchMemory.lastRenderedIndex = Number(el.querySelector<HTMLElement>('[data-shown]')?.dataset.shown ?? 1) - 1
    }
  }, [restored])

  // 只把属于当前查询的结果写进缓存，避免新关键词挂上旧结果。
  useEffect(() => {
    if (trimmed.length === 0) {
      searchMemory = null
      return
    }
    const key = searchKey(trimmed, partition, order, duration)
    if (dataKey !== key) return
    const currentUsers = usersReady ? users : []
    const currentUsersPage = usersReady ? usersPage : 1
    const currentUsersEnded = usersReady ? usersEnded : false
    if (!searchMemory || searchMemory.key !== key) {
      searchMemory = {
        key,
        tracks,
        users: currentUsers,
        page: loaded.current.page,
        ended,
        usersPage: currentUsersPage,
        usersEnded: currentUsersEnded,
        tab,
        filtersOpen,
        scrollTop: 0,
        lastRenderedIndex: 0,
      }
    } else {
      searchMemory.tracks = tracks
      searchMemory.users = currentUsers
      searchMemory.page = loaded.current.page
      searchMemory.ended = ended
      searchMemory.usersPage = currentUsersPage
      searchMemory.usersEnded = currentUsersEnded
      searchMemory.tab = tab
      searchMemory.filtersOpen = filtersOpen
    }
  }, [trimmed, partition, order, duration, dataKey, tracks, users, usersReady, usersPage, usersEnded, page, ended, tab, filtersOpen])

  // UP 主结果按关键词与分区重置；视频翻页、排序和时长筛选不动它。先排队以免被视频预取挡住。
  useEffect(() => {
    if (usersScope === userScope && users.length > 0) return
    const ticket = ++usersSeq.current
    setUsersScope('')
    setUsers([])
    setUsersPage(1)
    setUsersEnded(false)
    setUsersLoading(false)
    setUsersMoreError(false)
    setUsersError(false)
    if (trimmed.length === 0) return
    const handle = window.setTimeout(() => {
      void ipc
        .searchUsers(trimmed, 1)
        .then((list) => {
          if (usersSeq.current !== ticket) return
          setUsers(list)
          setUsersScope(userScope)
          setUsersPage(1)
          setUsersEnded(list.length === 0)
          setUsersError(false)
          loadFollowed(list)
        })
        .catch(() => {
          if (usersSeq.current !== ticket) return
          setUsers([])
          setUsersScope(userScope)
          setUsersPage(1)
          setUsersEnded(false)
          setUsersError(true)
        })
    }, 320)
    return () => {
      window.clearTimeout(handle)
      usersSeq.current += 1
    }
  }, [userScope, usersNonce, loadFollowed])

  useEffect(() => {
    if (trimmed.length === 0) {
      setStatus('idle')
      setTracks([])
      setError(null)
      searchMemory = null
      return
    }
    const key = searchKey(trimmed, partition, order, duration)
    if (loaded.current.key === key && loaded.current.page === page) return
    const ticket = ++seq.current
    const handle = window.setTimeout(() => {
      // 只有第 1 页算「正在搜索」；翻页是补内容，顶部不该一直转。
      if (page === 1) {
        setStatus('loading')
        setTracks([])
        setDataKey('')
        loaded.current = { key: '', page: 0 }
        setMoreError(false)
        setEnded(false)
        scrollerRef.current?.scrollTo({ top: 0 })
      }
      ipc
        .searchPage(
          trimmed,
          page,
          order,
          (() => {
            const tid = (PARTITIONS.find((p) => p.label === partition) ?? PARTITIONS[0]!).tid
            return tid ? [tid] : []
          })(),
          duration === 0 ? undefined : duration,
        )
        .then((next) => {
          if (seq.current !== ticket) return
          if (page === 1) pushHistory(trimmed)
          loaded.current = { key, page: next.page }
          setEnded(!next.has_more)
          setTracks((prev) => {
            if (page === 1) return next.tracks
            const seen = new Set(prev.map((track) => track.key))
            return [...prev, ...next.tracks.filter((track) => !seen.has(track.key))]
          })
          setDataKey(key)
          setStatus('ready')
          setLoadingMore(false)
          setMoreError(false)
        })
        .catch((cause: unknown) => {
          if (seq.current !== ticket) return
          setLoadingMore(false)
          if (page === 1) {
            setError(toWireError(cause))
            setStatus('error')
          } else {
            // 翻页失败就停在已取到的地方，别把整页结果换成错误页。
            // 但也不能当成「到底」：搜索碰上限流时只是这一分钟没取到，
            // 留个重试入口，用户点了再要同一页，别把整条结果链掐断。
            setMoreError(true)
          }
        })
      // 防抖只在第 1 页有意义：用户还在敲字，等他把词打完。
      // 翻页是明确的动作，再等 320ms 就是白等。
    }, page === 1 ? 320 : 0)
    return () => {
      window.clearTimeout(handle)
      seq.current += 1
    }
  }, [trimmed, page, nonce, order, partition, duration])

  useEffect(() => {
    const marker = sentinel.current
    if (!marker || tab === 'user' || status !== 'ready' || loadingMore || moreError || ended) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      observer.disconnect()
      setLoadingMore(true)
      setPage((current) => current + 1)
    }, { root: scrollerRef.current, rootMargin: '350px 0px' })
    observer.observe(marker)
    return () => observer.disconnect()
  }, [tab, status, loadingMore, moreError, ended, tracks])

  const loadMoreUsers = (): void => {
    if (!usersReady || usersLoading || usersEnded) return
    const ticket = ++usersSeq.current
    const nextPage = usersPage + 1
    setUsersLoading(true)
    setUsersMoreError(false)
    void ipc
      .searchUsers(trimmed, nextPage)
      .then((list) => {
        if (usersSeq.current !== ticket) return
        setUsers((prev) => {
          const seen = new Set(prev.map((user) => user.mid))
          const merged = [...prev]
          for (const user of list) {
            if (seen.has(user.mid)) continue
            seen.add(user.mid)
            merged.push(user)
          }
          return merged
        })
        setUsersPage(nextPage)
        setUsersEnded(list.length === 0)
        setUsersLoading(false)
        loadFollowed(list)
      })
      .catch(() => {
        if (usersSeq.current !== ticket) return
        setUsersLoading(false)
        setUsersMoreError(true)
      })
  }

  const selectTab = (value: SearchTab): void => {
    setTab(value)
    scrollerRef.current?.scrollTo({ top: 0 })
  }

  const changeVideoFilters = (update: Parameters<typeof setSearchFilters>[0]): void => {
    setSearchFilters(update)
    setPage(1)
    scrollerRef.current?.scrollTo({ top: 0 })
  }

  const openUser = (user: ipc.UserHit): void => {
    navigate({ kind: 'author', name: user.name, mid: user.mid }, undefined, `search-user:${user.mid}`)
  }

  return (
    <div
      ref={scrollerRef}
      id="scroll-main"
      data-search-results
      className="search-results-page min-h-0 flex-1 overflow-y-auto"
    >
      <div className="search-results-bar">
        {trimmed && (
          <nav aria-label="搜索结果分类" className="search-results-tabs">
            {([
              ['all', '综合'],
              ['video', '视频'],
              ['user', 'UP 主'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => selectTab(value)}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        {trimmed && <p className="search-committed-query truncate" title={trimmed}>「{trimmed}」的搜索结果</p>}
        <div className="search-results-actions">
          {trimmed && tab !== 'user' && (
            <button
              className="search-filter-toggle"
              type="button"
              aria-controls="search-video-filters"
              aria-expanded={filtersOpen}
              onClick={() => {
                setFiltersOpen(!filtersOpen)
                scrollerRef.current?.scrollTo({ top: 0 })
              }}
            >
              筛选
              <Icon name="chevronRight" size={14} className={filtersOpen ? '-rotate-90' : 'rotate-90'} />
            </button>
          )}
          <button type="button" onClick={goBack} className="search-go-back" aria-label="返回" title="返回">
            <Icon name="chevronLeft" size={15} /><span>返回</span>
          </button>
        </div>
      </div>
      {trimmed.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center text-[13px] text-[var(--text-3)]">
          在顶部搜索栏输入关键词
        </div>
      ) : (
          <section>
            {tab === 'user' && usersReady && users.length > 0 ? (
              <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {users.map((user) => (
                  <div
                    key={user.mid}
                    data-user-mid={user.mid}
                    className="bili-card flex w-full items-center gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 hover:border-[var(--accent)]"
                  >
                    <button
                      type="button"
                      data-focus-id={`search-user:${user.mid}`}
                      onClick={() => openUser(user)}
                      className="bili-press flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <Avatar src={user.face} alt={user.name} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate text-[13px] text-[var(--text-1)]">{user.name}</span>
                          {user.level > 0 ? <LevelBadge level={user.level} /> : null}
                          {user.official != null ? (
                            <span
                              title={user.verify || (user.official === 1 ? '机构认证' : '个人认证')}
                              className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-white"
                              style={{ background: user.official === 1 ? 'var(--accent)' : '#ffb027' }}
                            >
                              <Icon name="check" size={9} />
                            </span>
                          ) : null}
                        </span>
                        <span className="num mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--text-3)]">
                          {user.live ? (
                            <span className="shrink-0 rounded-[2px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
                              直播中
                            </span>
                          ) : null}
                          <span className="truncate">
                            {formatCount(user.fans)} 粉丝 · {formatCount(user.videos)} 投稿
                          </span>
                        </span>
                        {user.sign ? (
                          <span
                            className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]"
                            title={user.sign}
                          >
                            {user.sign}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {loggedIn ? (
                      <button
                        type="button"
                        disabled={followedMids.has(user.mid)}
                        onClick={() => {
                          void ipc
                            .followSet(user.mid, true)
                            .then(() => {
                              setFollowedMids((prev) => new Set(prev).add(user.mid))
                              toastDone('已关注', user.name)
                            })
                            .catch(() => toastDone('关注失败', '登录后再试'))
                        }}
                        className={[
                          't press ml-1 h-6 shrink-0 rounded-[4px] px-2 text-[12px]',
                          followedMids.has(user.mid)
                            ? 'border border-[var(--line)] text-[var(--text-3)]'
                            : 'bg-[var(--accent)] text-white hover:opacity-90',
                        ].join(' ')}
                      >
                        {followedMids.has(user.mid) ? '已关注' : '关注'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {tab === 'user' && !usersReady ? (
              <BiliLoader label="正在找 UP 主…" />
            ) : null}
            {tab === 'user' && usersReady && usersError ? (
              <div className="py-16 text-center text-[13px] text-[var(--text-3)]">
                UP 主没取到
                <button
                  type="button"
                  onClick={() => setUsersNonce((current) => current + 1)}
                  className="t press ml-2 text-[var(--accent)] hover:underline"
                >
                  重试
                </button>
              </div>
            ) : null}
            {tab === 'user' && usersReady && !usersError && users.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-[var(--text-3)]">没有找到相关 UP 主</p>
            ) : null}
            {tab === 'user' && usersReady && !usersError && users.length > 0 && !usersEnded ? (
              <div className="mt-4 flex flex-col items-center gap-2">
                {usersMoreError ? (
                  <button
                    type="button"
                    onClick={loadMoreUsers}
                    className="t press text-[13px] text-[var(--accent)] hover:underline"
                  >
                    没加载出来，重试这一页
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={usersLoading}
                      onClick={loadMoreUsers}
                      className="t press h-8 rounded-[4px] border border-[var(--line)] bg-[var(--panel)] px-4 text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                    >
                      更多 UP 主
                    </button>
                    {usersLoading ? <BiliLoader compact label="正在加载更多…" /> : null}
                  </>
                )}
              </div>
            ) : null}
            {tab === 'user' ? null : (
            <div>
            <div
              id="search-video-filters"
              className="search-video-filters"
              data-expanded={filtersOpen}
            >
              <div role="group" aria-label="视频排序" className="search-filter-row">
                <span>排序</span>
                <div>
                  {ORDERS.map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={order === value}
                      onClick={() => changeVideoFilters({ currentOrder: value })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <DurationFilter active={duration} onChange={(key) => changeVideoFilters({ currentDuration: key })} />
              <PartitionFilter active={partition} onChange={(label) => changeVideoFilters({ currentPartition: label })} />
            </div>
            {activeFilters.length > 0 && (
              <div className="search-filter-summary">
                <span>{activeFilters.join(' · ')}</span>
                <button type="button" onClick={() => changeVideoFilters({ currentPartition: '全部', currentOrder: 'totalrank', currentDuration: 0 })}>
                  清除筛选
                </button>
              </div>
            )}
            <div className="search-video-heading">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[19px] font-semibold text-[var(--text-1)]">视频</h2>
                {tracks.length > 0 ? (
                  <span className="num text-[12px] text-[var(--text-3)]">已加载 {formatCount(tracks.length)} 个</span>
                ) : null}
              </div>
              {tab === 'all' && usersReady && users.length > 0 ? (
                <div className="flex min-w-0 max-w-full items-center gap-2">
                  {users.slice(0, 2).map((user) => (
                    <button
                      key={user.mid}
                      type="button"
                      data-user-mid={user.mid}
                      data-focus-id={`search-user:${user.mid}`}
                      aria-label={`查看 UP 主 ${user.name}`}
                      onClick={() => openUser(user)}
                      className="t press flex min-w-0 max-w-32 items-center gap-1.5 rounded-full bg-[var(--ga0)] py-1 pl-1 pr-2 text-[12px] text-[var(--text-2)] hover:text-[var(--accent-strong)]"
                    >
                      <Avatar src={user.face} alt="" size={22} />
                      <span className="truncate">{user.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => selectTab('user')}
                    className="t press flex shrink-0 items-center gap-0.5 rounded px-1 py-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent-strong)]"
                  >
                    相关 UP 主 <Icon name="chevronRight" size={14} />
                  </button>
                </div>
              ) : null}
            </div>

            {status === 'loading' && tracks.length === 0 ? <BiliLoader label="正在 B 站里翻…" /> : null}

            {status === 'error' && error ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <EmptyState
                  icon="alert"
                  title={error.message}
                  detail="检查网络或登录状态后再试一次。"
                  action={{ label: '重试', onClick: () => setNonce((current) => current + 1) }}
                />
              </div>
            ) : null}

            {status === 'ready' && ended && tracks.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-1">
                <EmptyState
                  mascot="missYou"
                  icon="search"
                  title={
                    selectedPartition.tid
                      ? `「${trimmed}」在这个分区没有结果`
                      : `没有找到「${trimmed}」`
                  }
                  detail={
                    selectedPartition.tid
                      ? `这个词在${selectedPartition.label}区搜不到，试试去掉分区限制。`
                      : '换一个关键词，或者换个说法试试。'
                  }
                  action={
                    selectedPartition.tid
                      ? { label: '全站搜这个词', onClick: () => { changeVideoFilters({ currentPartition: '全部' }) } }
                      : { label: '返回', onClick: goBack }
                  }
                />

                {/* 给几条可点的替代词：优先用搜过的历史，其次用内置建议 */}
                {(() => {
                  // 历史和热搜会撞词，去重后再截：一排「试试」里出现两次同一个词很像 bug。
                  const seen = new Set<string>()
                  const words = [
                    ...history.map((w) => ({ keyword: w, label: w, icon: '', heat: 0 })),
                    ...trending,
                  ]
                    .filter((item) => {
                      if (item.keyword === trimmed || seen.has(item.keyword)) return false
                      seen.add(item.keyword)
                      return true
                    })
                    .slice(0, 5)
                  if (words.length === 0) return null
                  return (
                    <div className="-mt-8 flex flex-wrap items-center justify-center gap-1.5">
                      <span className="text-[12px] text-[var(--text-3)]">试试：</span>
                      {words.map((item) => (
                        <button
                          key={item.keyword}
                          type="button"
                          onClick={() => setHeroQuery(item.keyword)}
                          className="rounded-[3px] bg-[var(--panel-raised)] px-2 py-1 text-[12.5px] text-[var(--text-2)] hover:text-[var(--accent)]"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            ) : null}

            {tracks.length > 0 ? (
              <ContentGrid
                tracks={tracks}
                activeKey={snapshot?.track?.key ?? null}
                playing={snapshot?.phase === 'playing'}
                highlight={trimmed}
                initialIndex={restored?.lastRenderedIndex ?? 0}
              />
            ) : null}

            {status === 'ready' && (!ended || tracks.length > 0) ? (
              <div ref={sentinel} className="mt-6 flex items-center justify-center gap-2 text-[13px] text-[var(--text-3)]">
                {loadingMore || (tracks.length === 0 && !moreError) ? (
                  <BiliLoader compact label="正在加载更多…" />
                ) : moreError ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreError(false)
                      setLoadingMore(true)
                      setNonce((current) => current + 1)
                    }}
                    className="t press text-[var(--accent)] hover:underline"
                  >
                    没加载出来，重试这一页
                  </button>
                ) : ended ? (
                  <span className="text-[var(--text-3)]">到底了</span>
                ) : (
                  <span className="text-[var(--text-3)]">已加载 {tracks.length} 个 · 继续下滑查看更多</span>
                )}
              </div>
            ) : null}
            </div>
            )}
          </section>
        )}
    </div>
  )
}
