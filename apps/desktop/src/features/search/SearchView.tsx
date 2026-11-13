import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { formatCount } from '../../shared/lib/format'
import { thumbUrl } from '../../shared/lib/thumb'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { usePlayerStore } from '../player/playerStore'
import { ContentGrid } from '../tracks/ContentGrid'
import { PARTITIONS, PartitionFilter } from './PartitionFilter'
import { ContinueListening } from './ContinueListening'
import { DurationFilter, type DurationKey } from './DurationFilter'
import { useSearchHistory } from '../../shared/lib/searchHistory'
import { PREFETCH_PX } from '../../shared/lib/prefetch'

const SUGGESTIONS = ['晴天', '周深', '纯音乐', '夜空中最亮的星', '起风了']
// 三条事实压成一行：它们是说明，不是可点击的卡片，框起来只会挡住搜索。

type Status = 'idle' | 'loading' | 'ready' | 'error'

type SearchMemory = {
  key: string
  tracks: Track[]
  users: ipc.UserHit[]
  page: number
  scrollTop: number
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
  const [dataKey, setDataKey] = useState(restored?.key ?? '')
  const [status, setStatus] = useState<Status>(restored ? 'ready' : 'idle')
  const skipFirstFetch = useRef(restored !== null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [nonce, setNonce] = useState(0)
  // 统计行要说实话：用户选了「最多播放」，这里就不能还写着「按标题匹配排序」。
  const orderLabel: Record<typeof order, string> = {
    totalrank: '综合排序',
    click: '按播放量',
    pubdate: '按发布时间',
    danmaku: '按弹幕数',
  }
  const navigate = useAppStore((state) => state.navigate)
  const history = useSearchHistory((s) => s.items)
  const clearHistory = useSearchHistory((s) => s.clear)
  /** 热搜榜。取不到就退回内置建议，不让搜索页空着。 */
  const [hotWords, setHotWords] = useState<string[]>([])
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
  const trending = hotWords.length > 0 ? hotWords : SUGGESTIONS
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
    if (!heroQuery) return
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
  const inputRef = useRef<HTMLInputElement | null>(null)
  const focusSeq = useAppStore((state) => state.searchFocus)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const trimmed = query.trim()
  /** 上一页返回空就说明到底了；否则自动补齐会对着空页无限重试。 */
  const reachedEnd = useRef(false)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (el && restored) el.scrollTop = restored.scrollTop
  }, [restored])

  // 只把属于当前查询的结果写进缓存，避免新关键词挂上旧结果。
  useEffect(() => {
    if (trimmed.length === 0) {
      searchMemory = null
      return
    }
    const key = searchKey(trimmed, partition, order, duration)
    if (dataKey !== key) return
    if (!searchMemory || searchMemory.key !== key) {
      searchMemory = { key, tracks, users, page, scrollTop: 0 }
    } else {
      searchMemory.tracks = tracks
      searchMemory.users = users
      searchMemory.page = page
    }
  }, [trimmed, partition, order, duration, dataKey, tracks, users, page])

  // ⌘K 只在自增时抢焦点，用户自己点进来的渲染不会被打断。
  useEffect(() => {
    if (focusSeq === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSeq])

  useEffect(() => {
    if (trimmed.length === 0) {
      setStatus('idle')
      setTracks([])
      setUsers([])
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
        setUsers([])
        setDataKey('')
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
          setTracks((prev) => (page === 1 ? next : [...prev, ...next]))
          setDataKey(searchKey(trimmed, partition, order, duration))
          setStatus('ready')
          setLoadingMore(false)
          // UP 主单独一条搜索线。等视频结果落地再发，免得和 search_q 抢限速。
          if (page === 1) {
            void ipc
              .searchUsers(trimmed, 1)
              .then((list) => {
                if (seq.current === ticket) setUsers(list.slice(0, 6))
              })
              .catch(() => {
                if (seq.current === ticket) setUsers([])
              })
          }
        })
        .catch((cause: unknown) => {
          if (seq.current !== ticket) return
          setLoadingMore(false)
          if (page === 1) {
            setError(toWireError(cause))
            setStatus('error')
          } else {
            // 翻页失败就停在已取到的地方，别把整页结果换成错误页
            reachedEnd.current = true
          }
        })
      // 防抖只在第 1 页有意义：用户还在敲字，等他把词打完。
      // 翻页是明确的动作，再等 320ms 就是白等。
    }, page === 1 ? 320 : 0)
    return () => window.clearTimeout(handle)
  }, [trimmed, page, nonce, order, partition, duration])

  // 首屏之后自动补齐：滚到底时下一页往往已经在路上，继续滚也不会停。
  useEffect(() => {
    if (status !== 'ready' || loadingMore || tracks.length === 0 || reachedEnd.current) return
    const el = scrollerRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < PREFETCH_PX) {
      setLoadingMore(true)
      setPage((p) => p + 1)
    }
  }, [tracks, status, loadingMore])

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
          if (searchMemory) searchMemory.scrollTop = el.scrollTop
          // 到底之后不再翻页：滚动会一直触发，不挡住就是无限空请求。
          if (loadingMore || status !== 'ready' || tracks.length === 0 || reachedEnd.current) return
          // 缓冲不够深就预取：请求要在用户到达之前发出去。
          if (el.scrollHeight - el.scrollTop - el.clientHeight < PREFETCH_PX) {
            setLoadingMore(true)
            setPage((p) => p + 1)
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
              <button
                key={word}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(word)}
                className="t max-w-full break-all text-left text-[12.5px] text-[var(--text-2)] hover:text-[var(--accent)]"
              >
                {word}
              </button>
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
                {trending.map((word, index) => (
                  <li key={`${word}-${index}`}>
                    <button
                      type="button"
                      onClick={() => pick(word)}
                      className="t flex w-full items-baseline gap-2.5 rounded-[4px] py-1 text-left hover:bg-[var(--panel-alt)]"
                    >
                      <span
                        className={`num w-4 shrink-0 text-right text-[13px] ${
                          index < 3 ? 'text-[var(--bili-pink)]' : 'text-[var(--text-3)]'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--text-1)]">
                        {word}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <section className="mt-6">
            {users.length > 0 ? (
              <div className="mb-4">
                <h2 className="mb-2 text-[14px] font-medium text-[var(--text-1)]">UP 主</h2>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {users.map((user) => (
                    <button
                      key={user.mid}
                      type="button"
                      onClick={() => navigate({ kind: 'author', name: user.name, mid: user.mid })}
                      className="bili-card bili-press flex w-[248px] shrink-0 items-center gap-2.5 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-left hover:border-[var(--accent)]"
                    >
                      {user.face ? (
                        <img
                          src={thumbUrl(user.face, 80, 80) ?? user.face}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-10 w-10 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span className="h-10 w-10 shrink-0 rounded-full bg-[var(--panel-alt)]" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className="truncate text-[13px] text-[var(--text-1)]">{user.name}</span>
                          {user.level > 0 ? <LevelBadge level={user.level} /> : null}
                        </span>
                        <span className="num mt-0.5 block truncate text-[11.5px] text-[var(--text-3)]">
                          {formatCount(user.fans)} 粉丝 · {formatCount(user.videos)} 投稿
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mb-2 flex min-h-5 flex-wrap items-center justify-between gap-1 border-b border-hairline px-4 pb-2 text-[12px] tracking-[0.16em] text-[var(--text-2)]">
              <span>
                {status === 'error'
                  ? '搜索失败'
                  : status === 'loading'
                    ? '正在搜索…'
                    : status === 'ready'
                      // 说「已加载」而不是「为你找到」：这个数字随滚动增长，
                      // 写成结果总数就是把两件事混成一句谎话。
                      ? `已加载 ${tracks.length} 个 · ${orderLabel[order]} · 第 ${page} 页`
                      : ''}
              </span>
              {status === 'loading' && tracks.length > 0 ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-[var(--line)] border-t-white/70" />
              ) : null}
            </div>

            {tracks.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DurationFilter
                  active={duration}
                  onChange={(key) => {
                    setDuration(key)
                    setPage(1)
                  }}
                />

                <PartitionFilter
                  active={partition}
                  onChange={(label) => {
                    setPartition(label)
                    // 换分区等于换一次查询，必须从第 1 页开始，否则会追加到旧结果后面
                    setPage(1)
                  }}
                />
                <div className="mb-3 flex items-center gap-1">
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
                  const words = [
                    ...history.filter((w) => w !== trimmed),
                    ...trending.filter((w) => w !== trimmed),
                  ].slice(0, 5)
                  if (words.length === 0) return null
                  return (
                    <div className="-mt-8 flex flex-wrap items-center justify-center gap-1.5">
                      <span className="text-[12px] text-[var(--text-3)]">试试：</span>
                      {words.map((word) => (
                        <button
                          key={word}
                          type="button"
                          onClick={() => pick(word)}
                          className="rounded-[3px] bg-[var(--panel-raised)] px-2 py-1 text-[12.5px] text-[var(--text-2)] hover:text-[var(--accent)]"
                        >
                          {word}
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
              />
            ) : null}

            {status === 'ready' && tracks.length > 0 ? (
              <div ref={sentinel} className="mt-6 flex items-center justify-center gap-2 text-[13px] text-[var(--text-3)]">
                {loadingMore ? (
                  <>
                    <span className="bili-tv-mark text-[var(--accent)]">◌</span>
                    正在加载更多…
                  </>
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
