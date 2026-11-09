import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { usePlayerStore } from '../player/playerStore'
import { TrackGrid } from '../tracks/TrackGrid'
import { PARTITIONS, PartitionFilter } from './PartitionFilter'
import { ChannelGrid } from './ChannelGrid'
import { ContinueListening } from './ContinueListening'
import { HotRanking } from './HotRanking'
import { SearchBanner } from './SearchBanner'
import { useSearchHistory } from '../../shared/lib/searchHistory'

const SUGGESTIONS = ['晴天', '周深', '纯音乐', '夜空中最亮的星', '起风了']
// 三条事实压成一行：它们是说明，不是可点击的卡片，框起来只会挡住搜索。
const HINT = '本机直连 B 站｜不承诺无损，最高约 192K｜红心先落本机，登录后同步'

type Status = 'idle' | 'loading' | 'ready' | 'error'


export function SearchView() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [nonce, setNonce] = useState(0)
  const [tracks, setTracks] = useState<Track[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [partition, setPartition] = useState('全部')
  const [order, setOrder] = useState<'totalrank' | 'click' | 'pubdate' | 'danmaku'>('totalrank')
  const history = useSearchHistory((s) => s.items)
  const pushHistory = useSearchHistory((s) => s.push)
  const heroQuery = useAppStore((state) => state.heroQuery)
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)
  const authorQuery = useAppStore((state) => state.authorQuery)
  const setAuthorQuery = useAppStore((state) => state.setAuthorQuery)

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
      setError(null)
      return
    }
    const ticket = ++seq.current
    const handle = window.setTimeout(() => {
      setStatus('loading')
      if (page === 1) setTracks([])
      ipc
        .searchQ(
          trimmed,
          page,
          order,
          (PARTITIONS.find((p) => p.label === partition) ?? PARTITIONS[0]!).ids,
        )
        .then((next) => {
          if (seq.current !== ticket) return
          if (page === 1) pushHistory(trimmed)
          setTracks((prev) => (page === 1 ? next : [...prev, ...next]))
          setStatus('ready')
          setLoadingMore(false)
        })
        .catch((cause: unknown) => {
          if (seq.current !== ticket) return
          setError(toWireError(cause))
          setStatus('error')
        })
    }, 320)
    return () => window.clearTimeout(handle)
  }, [trimmed, page, nonce, order])

  const pick = (value: string): void => {
    setQuery(value)
    setPage(1)
    setNonce((current) => current + 1)
  }

  return (
    <div className="flex h-full flex-col">


      <div
        id="scroll-main"
        onScroll={(event) => {
          const el = event.currentTarget
          if (loadingMore || status !== 'ready' || tracks.length === 0) return
          // 距离底部不到 240px 就预取下一页，做得像 B 站那样无感。
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
            setLoadingMore(true)
            setPage((p) => p + 1)
          }
        }}
        className="bili-canvas min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-6"
      >
        {/* 搜索框在顶栏，这里只呈现结果。 */}

        {trimmed.length === 0 && history.length > 0 ? (
          <div className="bili-suggest relative z-20 -mt-1 rounded-b-[8px] border border-t-0 border-[var(--line)] bg-[var(--panel)] px-4 py-3 shadow-[0_10px_24px_-16px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-2">
              <span className="bili-tag-blue rounded-[3px] px-1.5 text-[12px] leading-[17px]">热门</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {SUGGESTIONS.map((word) => (
                  <button
                    key={word}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(word)}
                    className="t text-[12.5px] text-[var(--text-2)] hover:text-[var(--accent)]"
                  >
                    {word}
                  </button>
                ))}
              </div>
            </div>
            {history.length > 0 ? (
              <div className="mt-2.5 flex items-center gap-2 border-t border-[var(--line)] pt-2.5">
                <span className="rounded-[3px] bg-[var(--panel-raised)] px-1.5 text-[12px] leading-[17px] text-[var(--text-3)]">历史</span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {history.slice(0, 6).map((word) => (
                    <button
                      key={word}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(word)}
                      className="t text-[12.5px] text-[var(--text-3)] hover:text-[var(--accent)]"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {trimmed.length === 0 ? (
          <div className="mt-6">

            <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <SearchBanner />
              <div className="hidden h-full rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-3 xl:block">
                <HotRanking onPick={(kw) => pick(kw)} limit={6} />
              </div>
            </div>

            <div className="mt-8 text-[12px] uppercase tracking-[0.22em] text-[var(--text-2)]">试试这些</div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => pick(suggestion)}
                  className="t press text-[14px] text-[var(--text-2)] underline-offset-4 hover:text-[var(--text-1)] hover:underline"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <ContinueListening />

            <ChannelGrid onPick={(kw) => pick(kw)} />

            <p className="mt-8 max-w-3xl border-t border-hairline pt-4 text-[14px] leading-relaxed text-[var(--text-2)]">{HINT}</p>
          </div>
        ) : (
          <section className="mt-6">
            <div className="mb-2 flex min-h-5 items-center justify-between border-b border-hairline px-4 pb-2 text-[12px] tracking-[0.16em] text-[var(--text-2)]">
              <span>
                {status === 'error'
                  ? '搜索失败'
                  : status === 'loading'
                    ? '正在搜索…'
                    : status === 'ready'
                      ? `为你找到 ${tracks.length} 首 · 按标题匹配排序 · 第 ${page} 页`
                      : ''}
              </span>
              {status === 'loading' && tracks.length > 0 ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-[var(--line)] border-t-white/70" />
              ) : null}
            </div>

            {tracks.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PartitionFilter active={partition} onChange={setPartition} />
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
              <div className="flex min-h-[320px] items-center justify-center">
                <EmptyState
                  icon="search"
                  title={`没有找到「${trimmed}」`}
                  detail="换个关键词，或者换个说法试试。"
                  action={{ label: '清空条件', onClick: () => setQuery('') }}
                />
              </div>
            ) : null}

            {tracks.length > 0 ? (
              <TrackGrid
                tracks={tracks}
                activeKey={snapshot?.track?.key ?? null}
                playing={snapshot?.phase === 'playing'}
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
                  <span className="text-[var(--text-3)]">已加载 {tracks.length} 首 · 继续下滑查看更多</span>
                )}
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  )
}
