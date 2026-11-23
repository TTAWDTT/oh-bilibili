import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatTime } from '../../shared/lib/format'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { TrackDirectory } from '../tracks/TrackDirectory'
import { PageTitle } from '../../shared/ui/PageTitle'
import { Icon } from '../../shared/ui/Icon'
import { reportActionError } from '../../shared/lib/actionError'
import { toastDone, toastWarn } from '../../app/notice'
import { usePlayerStore } from '../player/playerStore'
import { useLoopOne } from '../watch/autoplay'
import { startWatchSession } from '../watch/watchSession'
import { useRetryAfterLogin } from './useRetryAfterLogin'

type Bucket = 'all' | 'short' | 'mid' | 'long' | 'unknown'

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'short', label: '10 分钟以内' },
  { id: 'mid', label: '10–30 分钟' },
  { id: 'long', label: '30 分钟以上' },
  { id: 'unknown', label: '时长未知' },
]

/** 回到这一页时保留筛选与阅读位置。 */
const memory = { bucket: 'all' as Bucket, top: 0 }

function bucketOf(track: Track): Exclude<Bucket, 'all'> {
  const ms = track.duration_ms
  if (ms === null || ms <= 0) return 'unknown'
  if (ms <= 10 * 60_000) return 'short'
  return ms <= 30 * 60_000 ? 'mid' : 'long'
}

type Resumed = { page: number; at: number }

/**
 * 本地记下的断点。按页的进度里带着分 P 号；
 * 单 P 视频没有页号，取位置最远的那个条目。
 */
function readResume(key: string): Resumed | null {
  try {
    const page = Number(localStorage.getItem(`oh-bilibili:watch-page:${key}`))
    if (Number.isInteger(page) && page > 0) {
      const at = Number(localStorage.getItem(`oh-bilibili:watch-pos:${key}:${page}`))
      return Number.isFinite(at) && at >= 5000 ? { page, at } : null
    }
    const prefix = `oh-bilibili:watch-pos:${key}:`
    let best: Resumed | null = null
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i)
      if (!name?.startsWith(prefix)) continue
      const no = Number(name.slice(prefix.length))
      const at = Number(localStorage.getItem(name) ?? 0)
      if (!Number.isInteger(no) || no <= 0 || !Number.isFinite(at) || at < 5000) continue
      if (!best || at > best.at) best = { page: no, at }
    }
    return best
  } catch {
    return null
  }
}

/**
 * 稍后再看。
 *
 * 一页就是一张待看片单：按行读片名、作者和断点，行内可以单条打开，
 * 也可以按当前筛选顺序从这里连续看下去。清单本身不受观看影响。
 */
export function WatchLaterView() {
  const navigate = useAppStore((s) => s.navigate)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<WireError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [bucket, setBucket] = useState<Bucket>(memory.bucket)
  const retry = () => setAttempt((n) => n + 1)
  const restored = useRef(false)

  useRetryAfterLogin(error, retry)

  const removeOne = async (key: string): Promise<void> => {
    try {
      await ipc.watchLaterSet(key, false)
      setTracks((prev) => (prev ?? []).filter((track) => track.key !== key))
      toastDone('已从稍后再看移除')
    } catch (e) {
      reportActionError('移出稍后再看', e)
    }
  }

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    setError(null)
    void ipc
      .watchLaterList()
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch((e) => {
        if (!cancelled) setError(toWireError(e))
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    if (restored.current || tracks === null) return
    restored.current = true
    const box = document.getElementById('scroll-main')
    if (box) box.scrollTop = memory.top
  }, [tracks])

  if (error) {
    const action =
      error.class === 'needs_login'
        ? { label: '去登录', onClick: () => setAuthOpen(true) }
        : error.class === 'retryable'
          ? { label: '重试', onClick: retry }
          : null
    return (
      <EmptyState
        icon="watchLater"
        title="稍后再看没取到"
        detail={error.message}
        action={action}
      />
    )
  }

  if (tracks === null) return <BiliLoader label="正在取稍后再看…" />

  if (tracks.length === 0) {
    return (
      <EmptyState
        icon="watchLater"
        title="还没有稍后再看"
        detail="在观看页点「稍后再看」，视频会出现在这里。"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  const counts: Record<Bucket, number> = { all: tracks.length, short: 0, mid: 0, long: 0, unknown: 0 }
  for (const track of tracks) counts[bucketOf(track)] += 1
  const visible = tracks.filter((track) => bucket === 'all' || bucketOf(track) === bucket)

  const startAt = (index: number): void => {
    const track = visible[index]
    if (!track) return
    if (useLoopOne.getState().enabled) {
      toastWarn('单曲循环开着', '连续观看不会自动跳到下一条')
    }
    startWatchSession(visible, index)
    navigate({ kind: 'watch', track })
  }

  return (
    <div
      id="scroll-main"
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
      onScroll={(event) => {
        memory.top = event.currentTarget.scrollTop
      }}
    >
      <PageTitle
        extra={`${tracks.length} 个`}
        action={
          <button
            type="button"
            disabled={visible.length === 0}
            onClick={() => startAt(0)}
            className="t press flex h-8 items-center gap-2 rounded-[4px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            <Icon name="play" size={13} />
            连续观看
          </button>
        }
      >
        稍后再看
      </PageTitle>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {BUCKETS.filter((entry) => entry.id !== 'unknown' || counts.unknown > 0).map((entry) => {
          const on = bucket === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                memory.bucket = entry.id
                setBucket(entry.id)
              }}
              className={[
                't press flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px]',
                on
                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                  : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)]',
              ].join(' ')}
            >
              {entry.label}
              <span className="num text-[11.5px] opacity-70">{counts[entry.id]}</span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-4 py-6 text-[13px] text-[var(--text-3)]">
          这个时长没有待看。
          <button
            type="button"
            onClick={() => {
              memory.bucket = 'all'
              setBucket('all')
            }}
            className="t text-[var(--accent)]"
          >
            查看全部
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)]">
          <div className="divide-y divide-[var(--line)]">
            {visible.map((track, index) => (
              <WatchLaterRow
                key={track.key}
                track={track}
                active={track.key === activeKey}
                onOpen={() => navigate({ kind: 'watch', track })}
                onAuthor={() =>
                  navigate(
                    { kind: 'author', name: track.artist, mid: track.up_mid ?? null },
                    undefined,
                    `later-author:${track.key}`,
                  )
                }
                onStart={() => startAt(index)}
                onRemove={() => void removeOne(track.key)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function WatchLaterRow({
  track,
  active,
  onOpen,
  onAuthor,
  onStart,
  onRemove,
}: {
  track: Track
  active: boolean
  onOpen: () => void
  onAuthor: () => void
  onStart: () => void
  onRemove: () => void
}) {
  const resume = readResume(track.key)
  return (
    <div
      data-watchlater-row
      className="group flex items-start gap-3 px-3 py-3 hover:bg-[var(--panel-alt)]"
    >
      <button
        type="button"
        onClick={onOpen}
        data-focus-id={`card:${track.key}`}
        aria-label={`观看 ${track.title}`}
        className="relative aspect-video w-[136px] shrink-0 overflow-hidden rounded-[6px] bg-[var(--panel-alt)] sm:w-[168px]"
      >
        <Cover cover={track.cover} title={track.title} width={220} className="h-full w-full" />
        {track.duration_ms ? (
          <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/70 px-1 text-[10px] leading-4 text-white">
            {formatTime(track.duration_ms)}
          </span>
        ) : null}
      </button>

      <div className="min-w-0 flex-1 py-0.5">
        <button
          type="button"
          onClick={onOpen}
          className={[
            'line-clamp-2 text-left text-[15px] font-medium leading-[22px]',
            active ? 'text-[var(--accent)]' : 'text-[var(--text-1)]',
          ].join(' ')}
        >
          {track.title}
        </button>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--text-3)]">
          <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[14px]">
            UP
          </span>
          <button
            type="button"
            onClick={onAuthor}
            data-focus-id={`later-author:${track.key}`}
            className="min-w-0 truncate text-left hover:text-[var(--accent-strong-hover)]"
          >
            {track.artist}
          </button>
        </div>
        <TrackDirectory track={track} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-3)]">
          {track.duration_ms ? null : <span>时长未知</span>}
          {resume ? (
            // 分 P 号已经在封面书脊上，这里只留时间，避免同一行说两遍。
            <span className="num">从 {formatTime(resume.at)} 继续</span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-center">
        <button
          type="button"
          onClick={onStart}
          className="t press rounded-[4px] px-2 py-1 text-[12.5px] text-[var(--text-3)] opacity-0 hover:bg-[var(--panel)] hover:text-[var(--accent)] focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
        >
          从这里连续观看
        </button>
        <button
          type="button"
          aria-label={`移除 ${track.title}`}
          title="从稍后再看移除"
          onClick={onRemove}
          className="t press flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--text-3)] opacity-0 hover:bg-[var(--panel)] hover:text-[var(--accent)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  )
}
