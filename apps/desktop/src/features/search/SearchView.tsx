import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { usePlayerStore } from '../player/playerStore'
import { ContentGrid } from '../tracks/ContentGrid'
import { PARTITIONS, PartitionFilter } from './PartitionFilter'
import { ContinueListening } from './ContinueListening'
import { DurationFilter, type DurationKey } from './DurationFilter'
import { useSearchHistory } from '../../shared/lib/searchHistory'

const SUGGESTIONS = ['晴天', '周深', '纯音乐', '夜空中最亮的星', '起风了']
// 三条事实压成一行：它们是说明，不是可点击的卡片，框起来只会挡住搜索。

type Status = 'idle' | 'loading' | 'ready' | 'error'


export function SearchView() {
  const storeQuery = useAppStore((state) => state.currentQuery)
  const [query, setQuery] = useState(storeQuery)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [nonce, setNonce] = useState(0)
  const [tracks, setTracks] = useState<Track[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [partition, setPartition] = useState(useAppStore.getState().currentPartition)
  const [order, setOrder] = useState(useAppStore.getState().currentOrder as 'totalrank' | 'click' | 'pubdate' | 'danmaku')
  // 统计行要说实话：用户选了「最多播放」，这里就不能还写着「按标题匹配排序」。
  const orderLabel: Record<typeof order, string> = {
    totalrank: '综合排序',
    click: '按播放量',
    pubdate: '按发布时间',
    danmaku: '按弹幕数',
  }
  const [duration, setDuration] = useState<DurationKey>((useAppStore.getState().currentDuration ?? 0) as DurationKey)
  const history = useSearchHistory((s) => s.items)
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
          (() => {
            const tid = (PARTITIONS.find((p) => p.label === partition) ?? PARTITIONS[0]!).tid
            return tid ? [tid] : []
          })(),
          duration === 0 ? undefined : duration,
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
  }, [trimmed, page, nonce, order, partition, duration])

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
        className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
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
                    className="t max-w-full break-all text-left text-[12.5px] text-[var(--text-2)] hover:text-[var(--accent)]"
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
                      className="t max-w-full break-all text-left text-[12.5px] text-[var(--text-3)] hover:text-[var(--accent)]"
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
          <div className="mt-2">
            {/* 搜索页只放「接着看什么」和「搜什么」。大 banner、排行榜、分区入口
                是首页的东西，摆在搜索页会让人以为这里是首页。 */}
            <ContinueListening />

            <div className="mt-7 text-[13px] text-[var(--text-3)]">大家都在搜</div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => pick(suggestion)}
                  className="t press rounded-full border border-[var(--line)] px-3 py-1 text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <section className="mt-6">
            <div className="mb-2 flex min-h-5 flex-wrap items-center justify-between gap-1 border-b border-hairline px-4 pb-2 text-[12px] tracking-[0.16em] text-[var(--text-2)]">
              <span>
                {status === 'error'
                  ? '搜索失败'
                  : status === 'loading'
                    ? '正在搜索…'
                    : status === 'ready'
                      ? `为你找到 ${tracks.length} 首 · ${orderLabel[order]} · 第 ${page} 页`
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
                    ...SUGGESTIONS.filter((w) => w !== trimmed),
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
