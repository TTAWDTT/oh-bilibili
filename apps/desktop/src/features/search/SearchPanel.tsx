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
import { DurationFilter, type DurationKey } from './DurationFilter'
import { useSearchHistory } from '../../shared/lib/searchHistory'

const SUGGESTIONS = ['晴天', '周深', '纯音乐', '夜空中最亮的星', '起风了']
// 三条事实压成一行：它们是说明，不是可点击的卡片，框起来只会挡住搜索。

type Status = 'idle' | 'loading' | 'ready' | 'error'

type SearchMemory = {
  key: string
  tracks: Track[]
  users: ipc.UserHit[]
  page: number
  usersPage: number
  usersEnded: boolean
  scrollTop: number
  /** 顶部第一张卡的序号；窗口化以后只靠像素恢复不回原处。 */
  index: number
}

/** 搜索结果按查询条件缓存：从视频页返回时不该重新搜一遍，也不该跳回顶部。 */
let searchMemory: SearchMemory | null = null

function searchKey(query: string, partition: string, order: string, duration: number): string {
  return [query, partition, order, duration].join('\u0000')
}

/**
 * 搜索结果面板。搜索没有独立页面：顶栏输入框下面直接长出这一块，
 * 点结果或按 Esc 收起，主页面保持在原处。
 */
export function SearchPanel() {
  const storeQuery = useAppStore((state) => state.currentQuery)
  const [query, setQuery] = useState(storeQuery)
  const [partition, setPartition] = useState(useAppStore.getState().currentPartition)
  const [order, setOrder] = useState(useAppStore.getState().currentOrder as 'totalrank' | 'click' | 'pubdate' | 'danmaku')
  const [duration, setDuration] = useState<DurationKey>((useAppStore.getState().currentDuration ?? 0) as DurationKey)

  const bootKey = searchKey(query.trim(), partition, order, duration)
  const restoreRef = useRef<SearchMemory | null | undefined>(undefined)
  if (restoreRef.current === undefined) {
    restoreRef.current =
      searchMemory && searchMemory.key === bootKey && searchMemory.tracks.length > 0 ? searchMemory : null
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
  const skipFirstFetch = useRef(restored !== null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  /** 这一批 UP 主里已经点过关注的人。只单向关注，不提供取关，避免误触。 */
  const [followedMids, setFollowedMids] = useState<ReadonlySet<number>>(new Set())
  const loggedIn = useAuthStore((state) => state.auth?.logged_in ?? false)
  /** 结果已经翻到头。ref 不能触发渲染，底部要据此换掉「继续下滑查看更多」。 */
  const [ended, setEnded] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [nonce, setNonce] = useState(0)
  const [usersNonce, setUsersNonce] = useState(0)
  /** B 站搜索页的结果分类。默认综合，视频与 UP 主分开看。 */
  const [tab, setTab] = useState<'all' | 'video' | 'user'>('all')
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
  const heroQuery = useAppStore((state) => state.heroQuery)
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)
  const setCurrentQuery = useAppStore((state) => state.setCurrentQuery)
  const setSearchFilters = useAppStore((state) => state.setSearchFilters)
  const closeSearch = useAppStore((state) => state.closeSearch)

  // 把实际在搜的词与筛选条件同步给 store：
  // 顶栏跟着它走，切走再回来也能恢复。
  useEffect(() => {
    setCurrentQuery(query)
    setSearchFilters(partition, order, duration)
  }, [query, partition, order, duration, setCurrentQuery, setSearchFilters])

  // 顶栏搜索框提交后，这里接住关键词并立刻搜一次。
  useEffect(() => {
    // 空串是「搜一个空词」：清掉结果回到热搜页，不能当成没提交。
    if (heroQuery === null) return
    setQuery(heroQuery)
    setPage(1)
    setTab('all')
    setNonce((n) => n + 1)
    setHeroQuery(null)
  }, [heroQuery, setHeroQuery])

  const [error, setError] = useState<WireError | null>(null)
  const seq = useRef(0)
  const usersSeq = useRef(0)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const trimmed = query.trim()
  const userScope = [trimmed, partition].join('\u0000')
  const usersReady = usersScope === userScope
  /** 上一页返回空就说明到底了；否则自动补齐会对着空页无限重试。 */
  const reachedEnd = useRef(false)

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
    if (!el || !restored) return
    const card =
      restored.index > 0
        ? el.querySelector<HTMLElement>(`[data-track-card][data-index="${restored.index}"]`)
        : null
    if (card) {
      el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
    } else {
      el.scrollTop = restored.scrollTop
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
        page,
        usersPage: currentUsersPage,
        usersEnded: currentUsersEnded,
        scrollTop: 0,
        index: 0,
      }
    } else {
      searchMemory.tracks = tracks
      searchMemory.users = currentUsers
      searchMemory.page = page
      searchMemory.usersPage = currentUsersPage
      searchMemory.usersEnded = currentUsersEnded
    }
  }, [trimmed, partition, order, duration, dataKey, tracks, users, usersReady, usersPage, usersEnded, page])

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
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false
      return
    }
    const ticket = ++seq.current
    const handle = window.setTimeout(() => {
      // 只有第 1 页算「正在搜索」；翻页是补内容，顶部不该一直转。
      if (page === 1) {
        setStatus('loading')
        setTracks([])
        setDataKey('')
        setMoreError(false)
        setEnded(false)
        scrollerRef.current?.scrollTo({ top: 0 })
      }
      ipc
        .searchQ(
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
          reachedEnd.current = next.length === 0
          setEnded(next.length === 0)
          setTracks((prev) => (page === 1 ? next : [...prev, ...next]))
          setDataKey(searchKey(trimmed, partition, order, duration))
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
    return () => window.clearTimeout(handle)
  }, [trimmed, page, nonce, order, partition, duration])

  /** 卡片网格的缓冲浅到阈值就来要下一页。 */
  const needMore = (): void => {
    if (tab === 'user' || status !== 'ready' || loadingMore || moreError || reachedEnd.current) return
    setLoadingMore(true)
    setPage((p) => p + 1)
  }

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
        setUsers((prev) => [...prev, ...list])
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

  const pick = (value: string): void => {
    setQuery(value)
    setPage(1)
    setTab('all')
    setNonce((current) => current + 1)
  }

  return (
    <div className="bili-search-overlay">
      {/* 点面板外收起。压一层半透明底色，页面退后一步，面板才是焦点。 */}
      <div
        aria-hidden
        onClick={closeSearch}
        className="absolute inset-0 bg-[color-mix(in_oklab,var(--text-1)_10%,transparent)]"
      />
      <section
        role="dialog"
        aria-label="搜索结果"
        ref={scrollerRef}
        id="search-scroll"
        onScroll={(event) => {
          const el = event.currentTarget
          if (!searchMemory) return
          searchMemory.scrollTop = el.scrollTop
          const max = el.scrollHeight - el.clientHeight
          const rendered = Number(el.querySelector<HTMLElement>('[data-shown]')?.dataset.shown ?? 0)
          if (max > 0 && rendered > 1) {
            searchMemory.index = Math.round((el.scrollTop / max) * (rendered - 1))
          }
        }}
        className="bili-search-sheet absolute inset-x-0 top-0 mx-auto h-[calc(100%-10px)] w-[min(1240px,calc(100%-24px))] overflow-y-auto rounded-b-[12px] border border-t-0 border-[var(--line)] bg-[var(--panel)] px-5 pb-10 pt-4"
      >
        {trimmed.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center text-[13px] text-[var(--text-3)]">
            在顶部搜索栏输入关键词
          </div>
        ) : (
          <section>
            {/* B 站搜索页的分类 tab：综合里同时有 UP 主和视频，也可以只看其中一类。 */}
            <nav
              aria-label="搜索结果分类"
              className="sticky top-0 z-10 -mx-5 mb-3 flex gap-6 border-b border-[var(--line)] bg-[var(--panel)] px-5"
            >
              {(
                [
                  ['all', '综合'],
                  ['video', '视频'],
                  ['user', 'UP 主'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-current={tab === value ? 'page' : undefined}
                  onClick={() => {
                    setTab(value)
                    scrollerRef.current?.scrollTo({ top: 0 })
                  }}
                  className={`t border-b-2 pb-2 text-[14px] ${
                    tab === value
                      ? 'border-[var(--accent)] font-medium text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-2)] hover:text-[var(--accent)]'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={closeSearch}
                aria-label="关闭搜索"
                title="关闭搜索"
                className="t press mb-2 ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]"
              >
                <Icon name="close" size={15} />
              </button>
            </nav>
            {tab !== 'video' && usersReady && users.length > 0 ? (
              <div className="mb-4">
                {tab === 'user' ? null : (
                  <h2 className="mb-2 text-[14px] font-medium text-[var(--text-1)]">UP 主</h2>
                )}
                <div
                  className={
                    tab === 'user'
                      ? 'grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3'
                      : 'no-scrollbar flex gap-2 overflow-x-auto pb-1'
                  }
                >
                  {(tab === 'user' ? users : users.slice(0, 6)).map((user) => (
                    <div
                      key={user.mid}
                      className={`bili-card flex items-center gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 hover:border-[var(--accent)] ${tab === 'user' ? 'w-full' : 'w-[248px] shrink-0'}`}
                    >
                    <button
                      type="button"
                      onClick={() => navigate({ kind: 'author', name: user.name, mid: user.mid })}
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
            <div className="mb-2 flex min-h-5 items-center justify-between gap-1 border-b border-hairline px-4 pb-2 text-[12px] text-[var(--text-3)]">
              <span>
                {status === 'error'
                  ? '搜索失败'
                  : status === 'loading'
                    ? '正在搜索…'
                    : loadingMore
                      ? '正在加载更多…'
                      : ''}
              </span>
              <span className="flex items-center gap-2">
                {tracks.length > 0 ? (
                  // 「已加载」不说「共」：这个数字随滚动增长，不是 B 站的结果总数。
                  <span className="num">已加载 {formatCount(tracks.length)} 个</span>
                ) : null}
              </span>
            </div>

            {tracks.length > 0 ? (
              <div className="mb-2 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <DurationFilter
                    active={duration}
                    onChange={(key) => {
                      setDuration(key)
                      setPage(1)
                    }}
                  />
                  <div className="flex items-center gap-1">
                  {([
                    ['totalrank', '综合'],
                    ['click', '最多播放'],
                    ['pubdate', '最新发布'],
                    ['danmaku', '最多弹幕'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setOrder(value)}
                      aria-pressed={order === value}
                      className={[
                        't rounded-[4px] px-2 py-1 text-[13px]',
                        order === value
                          ? 'text-[var(--accent)]'
                          : 'text-[var(--text-3)] hover:text-[var(--text-1)]',
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  ))}
                  </div>
                </div>

                <PartitionFilter
                  active={partition}
                  onChange={(label) => {
                    setPartition(label)
                    // 换分区等于换一次查询，必须从第 1 页开始，否则会追加到旧结果后面
                    setPage(1)
                  }}
                />
              </div>
            ) : null}

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

            {status === 'ready' && tracks.length === 0 ? (
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
                      ? { label: '全站搜这个词', onClick: () => setPartition('全部') }
                      : { label: '清空条件', onClick: () => setQuery('') }
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
                          onClick={() => pick(item.keyword)}
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
                onNeedMore={needMore}
                initialIndex={restored?.index ?? 0}
              />
            ) : null}

            {status === 'ready' && tracks.length > 0 ? (
              <div ref={sentinel} className="mt-6 flex items-center justify-center gap-2 text-[13px] text-[var(--text-3)]">
                {loadingMore ? (
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
      </section>
    </div>
  )
}
