import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'
import { TrackGrid } from '../tracks/TrackGrid'
import { PARTITIONS, PartitionFilter } from './PartitionFilter'

const PAGE_SIZE = 8
const SUGGESTIONS = ['晴天', '周深', '纯音乐', '夜空中最亮的星', '起风了']
// 三条事实压成一行：它们是说明，不是可点击的卡片，框起来只会挡住搜索。
const HINT = '本机直连 B 站｜不承诺无损，最高约 192K｜红心先落本机，登录后同步'

type Status = 'idle' | 'loading' | 'ready' | 'error'

function PagerButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="t press rounded-[4px] border border-hairline h-8 px-4 text-[12px] text-[var(--text-2)] hover:border-[var(--line)] hover:text-white disabled:cursor-default disabled:opacity-30"
    >
      {label}
    </button>
  )
}

export function SearchView() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [nonce, setNonce] = useState(0)
  const [tracks, setTracks] = useState<Track[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [partition, setPartition] = useState('全部')
  const [order, setOrder] = useState<'totalrank' | 'click' | 'pubdate' | 'danmaku'>('totalrank')
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
          setTracks(next)
          setStatus('ready')
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


      <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-6">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setNonce((current) => current + 1)
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] border border-hairline bg-[var(--panel-raised)] px-4 py-3 focus-within:border-[var(--line)]">
            <Icon name="search" size={18} className="text-[var(--text-2)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              aria-label="搜索歌曲"
              placeholder="歌名、UP 主，或者一句歌词"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-1)] placeholder:text-[var(--text-2)]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="清空输入"
                title="清空输入"
                className="t press flex items-center justify-center rounded-[4px] h-6 w-6 text-[var(--text-2)] hover:text-[var(--text-1)]"
              >
                <Icon name="close" size={14} />
              </button>
            ) : (
              <kbd className="kbd hidden shrink-0 sm:inline-flex" aria-hidden>
                ⌘K
              </kbd>
            )}
          </div>
          <button
            type="submit"
            aria-label="搜索"
            className="search-btn-pink flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white"
          >
            <Icon name="search" size={15} />
          </button>

        </form>

        {trimmed.length === 0 ? (
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-2)]">试试这些</div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => pick(suggestion)}
                  className="t press text-[13px] text-[var(--text-2)] underline-offset-4 hover:text-white hover:underline"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <p className="mt-8 max-w-3xl border-t border-hairline pt-4 text-[12px] leading-relaxed text-[var(--text-2)]">{HINT}</p>
          </div>
        ) : (
          <section className="mt-6">
            <div className="mb-2 flex min-h-5 items-center justify-between border-b border-hairline px-4 pb-2 text-[11px] tracking-[0.16em] text-[var(--text-2)]">
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
                        't rounded-[4px] px-2 py-1 text-[11.5px]',
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

            {status === 'loading' && tracks.length === 0 ? <TrackListSkeleton rows={6} /> : null}

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
              <div className="mt-6 flex items-center justify-center gap-2">
                <PagerButton label="上一页" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} />
                <span className="num px-2 font-mono text-[11px] text-[var(--text-2)]">{page}</span>
                <PagerButton
                  label="下一页"
                  disabled={tracks.length < PAGE_SIZE}
                  onClick={() => setPage((current) => current + 1)}
                />
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  )
}
