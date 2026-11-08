import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'
import { TrackList } from '../tracks/TrackList'

const PAGE_SIZE = 8
const SUGGESTIONS = ['晴天', '周深', '纯音乐', '夜空中最亮的星', '起风了']
const HINTS = [
  { title: '本机直连', detail: '请求从这台电脑直达 B 站，不经过任何中间服务器。' },
  { title: '不承诺无损', detail: 'B 站音轨最高约 192K，播放页如实显示实际码率。' },
  { title: '喜欢可离线', detail: '红心先落本机，登录后统一同步到 B 站账号。' },
]

type Status = 'idle' | 'loading' | 'ready' | 'error'

function PagerButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="t press rounded-full border border-white/10 px-4 py-1.5 text-[11.5px] text-white/52 hover:border-white/24 hover:text-white/85 disabled:cursor-default disabled:opacity-30"
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
  const [error, setError] = useState<WireError | null>(null)
  const seq = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const focusSeq = useAppStore((state) => state.searchFocus)
  const playContext = usePlayerStore((state) => state.playContext)
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
        .searchQ(trimmed, page)
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
  }, [trimmed, page, nonce])

  const pick = (value: string): void => {
    setQuery(value)
    setPage(1)
    setNonce((current) => current + 1)
  }

  const keys = tracks.map((track) => track.key)
  const activeKey = snapshot?.track?.key ?? null
  const playing = snapshot?.phase === 'playing'

  return (
    <div className="h-full max-w-[1040px] overflow-y-auto px-8 pb-10 pt-8">
      <PageHeader
        eyebrow="搜索"
        title="搜一首歌"
        subtitle="歌名、UP 主都行。结果按标题匹配度排序，音源从你自己的 B 站账号可访问的视频里取。"
        actions={
          trimmed ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="t press rounded-full border border-white/10 px-4 py-1.5 text-[11.5px] text-white/52 hover:border-white/24 hover:text-white/85"
            >
              清空
            </button>
          ) : null
        }
      />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          setNonce((current) => current + 1)
        }}
        className="mt-6"
      >
        <div className="glass flex items-center gap-3 rounded-2xl border border-hairline px-4 py-3 focus-within:border-white/28">
          <Icon name="search" size={18} className="text-white/32" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            aria-label="搜索歌曲"
            placeholder="歌名、UP 主，或者一句歌词"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-white/90 placeholder:text-white/26"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空输入"
              title="清空输入"
              className="t press rounded-full p-1 text-white/34 hover:bg-white/10 hover:text-white/80"
            >
              <Icon name="close" size={14} />
            </button>
          ) : (
            <kbd className="kbd hidden shrink-0 sm:inline-flex" aria-hidden>
              ⌘K
            </kbd>
          )}
        </div>
      </form>

      {trimmed.length === 0 ? (
        <div className="mt-10">
          <div className="text-[10.5px] uppercase tracking-[0.22em] text-white/32">试试这些</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => pick(suggestion)}
                className="t press rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[12.5px] text-white/64 hover:border-white/24 hover:bg-white/[0.06] hover:text-white/92"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-3">
            {HINTS.map((hint) => (
              <div key={hint.title} className="rounded-2xl border border-hairline bg-white/[0.02] p-4">
                <div className="text-[12.5px] text-white/76">{hint.title}</div>
                <div className="mt-2 text-[11px] leading-relaxed text-white/38">{hint.detail}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <section className="mt-8">
          <div className="mb-2 flex min-h-5 items-center justify-between px-3 text-[10.5px] tracking-[0.16em] text-white/32">
            <span>
              {status === 'error'
                ? '搜索失败'
                : status === 'loading'
                  ? '正在搜索…'
                  : status === 'ready'
                    ? `第 ${page} 页 · ${tracks.length} 首`
                    : ''}
            </span>
            {status === 'loading' && tracks.length > 0 ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
            ) : null}
          </div>

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
            <TrackList
              tracks={tracks}
              activeKey={activeKey}
              playing={playing}
              onPlay={(index) => void playContext(keys, index)}
            />
          ) : null}

          {status === 'ready' && tracks.length > 0 ? (
            <div className="mt-6 flex items-center justify-center gap-2">
              <PagerButton label="上一页" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} />
              <span className="num px-2 font-mono text-[11px] text-white/32">{page}</span>
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
  )
}
