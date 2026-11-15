import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { ContinueListening } from './ContinueListening'
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
  scrollTop: number
  /** 顶部第一张卡的序号；窗口化以后只靠像素恢复不回原处。 */
  index: number
}

/** 搜索结果按查询条件缓存：从视频页返回时不该重新搜一遍，也不该跳回顶部。 */
let searchMemory: SearchMemory | null = null

function searchKey(query: string, partition: string, order: string, duration: number): string {
  return [query, partition, order, duration].join('\u0000')
}

export function SearchView() {
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
  const [usersQuery, setUsersQuery] = useState(restored?.users.length ? query.trim() : '')
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
  const navigate = useAppStore((state) => state.navigate)
  const history = useSearchHistory((s) => s.items)
  const clearHistory = useSearchHistory((s) => s.clear)
  const removeHistory = useSearchHistory((s) => s.remove)
  /** 热搜榜。取不到就退回内置建议，不让搜索页空着。 */
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
  const authorQuery = useAppStore((state) => state.authorQuery)
  const setAuthorQuery = useAppStore((state) => state.setAuthorQuery)

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
    setNonce((n) => n + 1)
    setHeroQuery(null)
  }, [heroQuery, setHeroQuery])

  // 从别处点 UP 主进来时，把名字填进搜索框并立刻搜一次。
  useEffect(() => {
    if (!authorQuery) return
    setQuery(authorQuery)
    setPage(1)
    setNonce((n) => n + 1)
    setAuthorQuery(null)
  }, [authorQuery, setAuthorQuery])
  const [error, setError] = useState<WireError | null>(null)
  const seq = useRef(0)
  const usersSeq = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const focusSeq = useAppStore((state) => state.searchFocus)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const trimmed = query.trim()
  /** 上一页返回空就说明到底了；否则自动补齐会对着空页无限重试。 */
  const reachedEnd = useRef(false)

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
    const currentUsers = usersQuery === trimmed ? users : []
    if (!searchMemory || searchMemory.key !== key) {
      searchMemory = { key, tracks, users: currentUsers, page, scrollTop: 0, index: 0 }
    } else {
      searchMemory.tracks = tracks
      searchMemory.users = currentUsers
      searchMemory.page = page
    }
  }, [trimmed, partition, order, duration, dataKey, tracks, users, usersQuery, page])

  // ⌘K 只在自增时抢焦点，用户自己点进来的渲染不会被打断。
  useEffect(() => {
    if (focusSeq === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSeq])

  // UP 主属于关键词，视频翻页和筛选不能作废它；先排队以免被视频预取挡住。
  useEffect(() => {
    if (usersQuery === trimmed) return
    const ticket = ++usersSeq.current
    if (trimmed.length === 0) {
      setUsers([])
      setUsersQuery('')
      return
    }
    const handle = window.setTimeout(() => {
      void ipc
        .searchUsers(trimmed, 1)
        .then((list) => {
          if (usersSeq.current !== ticket) return
          setUsers(list.slice(0, 6))
          setUsersQuery(trimmed)
          void ipc
            .relationFollowedMany(list.map((u) => u.mid))
            .then((rows) => {
              setFollowedMids(
                (prev) => new Set([...prev, ...rows.filter(([, on]) => on).map(([mid]) => mid)]),
              )
            })
            .catch(() => {})
        })
        .catch(() => {
          if (usersSeq.current !== ticket) return
          setUsers([])
          setUsersQuery(trimmed)
        })
    }, 320)
    return () => {
      window.clearTimeout(handle)
      usersSeq.current += 1
    }
  }, [trimmed, usersQuery])

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
    if (status !== 'ready' || loadingMore || moreError || reachedEnd.current) return
    setLoadingMore(true)
    setPage((p) => p + 1)
  }

  const pick = (value: string): void => {
    setQuery(value)
    setPage(1)
    setNonce((current) => current + 1)
  }

  return (
    <div className="flex h-full flex-col">


      <div
        ref={scrollerRef}
        id="scroll-main"
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
        className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
      >
        {/* 搜索框在顶栏，这里只呈现结果。 */}

        {/* 只有搜索历史就没有可展示的了（热搜在下面有整块榜单，
            这里再排一遍同样的词就是重复）。 */}
        {trimmed.length === 0 && history.length > 0 ? (
          <div className="bili-suggest relative z-20 -mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-b-[8px] border border-t-0 border-[var(--line)] bg-[var(--panel)] px-4 py-3 shadow-[0_10px_24px_-16px_rgba(0,0,0,0.35)]">
            <span className="rounded-[3px] bg-[var(--panel-raised)] px-1.5 text-[12px] leading-[17px] text-[var(--text-3)]">
              历史
            </span>
            {history.slice(0, 8).map((word) => (
              <span key={word} className="group/h inline-flex max-w-full items-center">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(word)}
                  className="t max-w-full break-all text-left text-[12.5px] text-[var(--text-2)] hover:text-[var(--accent)]"
                >
                  {word}
                </button>
                {/* B 站的历史词也能单独删，不必为了去掉一个词清空整串。 */}
                <button
                  type="button"
                  aria-label={`删除历史 ${word}`}
                  title="删除这个词"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => removeHistory(word)}
                  className="t ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] opacity-0 hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)] group-hover/h:opacity-100"
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearHistory}
              className="t ml-auto shrink-0 text-[11.5px] text-[var(--text-3)] hover:text-[var(--accent)]"
            >
              清除
            </button>
          </div>
        ) : null}

        {trimmed.length === 0 ? (
          <div className="mt-2 pb-10">
            <ContinueListening />

            {/* 热搜榜。B 站搜索页左侧就是这份榜单，带名次；这里铺成两列，
                页面的空档也就填上了。 */}
            <div className="mt-9">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[14px] font-medium text-[var(--text-1)]">热搜</h2>
                <span className="text-[12px] text-[var(--text-3)]">大家都在搜</span>
              </div>
              <ol className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3">
                {trending.map((item, index) => (
                  <li key={`${item.keyword}-${index}`}>
                    <button
                      type="button"
                      onClick={() => pick(item.keyword)}
                      className="t flex w-full items-baseline gap-2.5 rounded-[4px] py-1 text-left hover:bg-[var(--panel-alt)]"
                    >
                      <span
                        className={`num w-4 shrink-0 text-right text-[13px] ${
                          index < 3 ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'
                        }`}
                      >
                        {index + 1}
                      </span>
                      {item.icon ? <img src={item.icon} alt="" className="h-3.5 w-auto shrink-0" /> : null}
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--text-1)]">
                        {item.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <section className="mt-6">
            {usersQuery === trimmed && users.length > 0 ? (
              <div className="mb-4">
                <h2 className="mb-2 text-[14px] font-medium text-[var(--text-1)]">UP 主</h2>
                <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                  {users.map((user) => (
                    <div
                      key={user.mid}
                      className="bili-card flex w-[248px] shrink-0 items-center gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 hover:border-[var(--accent)]"
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
                {status === 'loading' && tracks.length > 0 ? (
                  <span className="h-3 w-3 animate-spin rounded-full border border-[var(--line)] border-t-white/70" />
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
          </section>
        )}
      </div>
    </div>
  )
}
