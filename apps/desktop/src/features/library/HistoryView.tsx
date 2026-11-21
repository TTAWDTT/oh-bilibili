import { Icon } from '../../shared/ui/Icon'
import { reportActionError } from '../../shared/lib/actionError'
import { toastDone } from '../../app/notice'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { usePlayerStore } from '../player/playerStore'
import { PageTitle } from '../../shared/ui/PageTitle'
import { AnchoredPanel, type Anchor } from '../../shared/ui/AnchoredPanel'
import { formatTime } from '../../shared/lib/format'

const HISTORY_PAGE = 60

type Entry = import('../../shared/lib/ipc').HistoryEntry

/** 按会话记住这一屏：从别处回到历史时，页数、位置和焦点都要原样回来。 */
const historyMemory: {
  entries: Entry[]
  cursor: { played_at: number; id: number } | null
  hasMore: boolean
  scrollTop: number
  focusKey: string | null
} = { entries: [], cursor: null, hasMore: true, scrollTop: 0, focusKey: null }

/**
 * 播放历史。数据来自 SQLite 的 history 表，是真正播过的记录。
 *
 * 伪造一份「最近播放」很容易，但那不是历史——历史必须由播放动作写入。
 */
export function HistoryView() {
  const restored = historyMemory.entries.length > 0
  const [entries, setEntries] = useState<Entry[] | null>(restored ? historyMemory.entries : null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [hasMore, setHasMore] = useState(restored ? historyMemory.hasMore : true)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 下一页从这一条之后取：播放过的条目会跳到最前，offset 会重复或漏项。 */
  const [cursor, setCursor] = useState<{ played_at: number; id: number } | null>(
    restored ? historyMemory.cursor : null,
  )
  const snapshot = usePlayerStore((state) => state.snapshot)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const restorePending = useRef(restored)

  useEffect(() => {
    if (restored) return
    let cancelled = false
    void ipc
      .libraryHistoryTimed(HISTORY_PAGE)
      .then((list) => {
        if (cancelled) return
        setEntries(list)
        const last = list[list.length - 1]
        setCursor(last ? { played_at: last.played_at, id: last.id } : null)
        setHasMore(list.length === HISTORY_PAGE)
      })
      .catch((e) => {
        if (!cancelled) setError(toWireError(e).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    historyMemory.entries = entries ?? []
    historyMemory.cursor = cursor
    historyMemory.hasMore = hasMore
  }, [entries, cursor, hasMore])

  useLayoutEffect(() => {
    const box = scrollerRef.current
    if (!box || !restorePending.current) return
    restorePending.current = false
    box.scrollTop = historyMemory.scrollTop
    const key = historyMemory.focusKey
    if (!key) return
    const row = [...box.querySelectorAll<HTMLElement>('[data-history-row]')].find(
      (element) => element.dataset.key === key,
    )
    row?.querySelector<HTMLElement>('button[data-history-play]')?.focus({ preventScroll: true })
  }, [entries])

  /** 再取一页更早的记录。用上一页最旧一条的 (played_at, id) 作边界。 */
  const loadOlder = async (): Promise<void> => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const older = await ipc.libraryHistoryTimed(HISTORY_PAGE, cursor)
      setEntries((prev) => {
        const seen = new Set((prev ?? []).map((entry) => entry.track.key))
        return [...(prev ?? []), ...older.filter((entry) => !seen.has(entry.track.key))]
      })
      const last = older[older.length - 1]
      if (last) setCursor({ played_at: last.played_at, id: last.id })
      setHasMore(older.length === HISTORY_PAGE)
    } catch (e) {
      reportActionError('加载更早记录', e)
    } finally {
      setLoadingMore(false)
    }
  }

  // 按自然日分组：今天 / 昨天 / 更早。B 站的历史就是这么分的。
  /** 删掉一首歌的全部历史。 */
  const removeOne = async (key: string): Promise<void> => {
    try {
      await ipc.historyDelete(key)
      const next = (entries ?? []).filter((e) => e.track.key !== key)
      if (next.length === 0 && hasMore) {
        // 已加载的删光了，但数据源还有更早的记录：从最新一页重新读，
        // 不能把「还没有播放记录」提前亮出来。
        setLoadingMore(true)
        try {
          const list = await ipc.libraryHistoryTimed(HISTORY_PAGE)
          setEntries(list)
          const last = list[list.length - 1]
          setCursor(last ? { played_at: last.played_at, id: last.id } : null)
          setHasMore(list.length === HISTORY_PAGE)
        } catch (loadError) {
          reportActionError('加载更早记录', loadError)
        } finally {
          setLoadingMore(false)
        }
      } else {
        setEntries(next)
      }
    } catch (e) {
      reportActionError('删除记录', e)
    }
  }

  /** 清空全部历史。 */
  const clearAll = async (): Promise<void> => {
    try {
      await ipc.historyClear()
      setEntries([])
      setCursor(null)
      setHasMore(false)
      setConfirmingClear(false)
      toastDone('历史已清空')
    } catch (e) {
      reportActionError('清空历史', e)
    }
  }

  type Entry = import('../../shared/lib/ipc').HistoryEntry
  const groups = (() => {
    if (entries === null) return [] as { key: string; label: string; items: Entry[] }[]
    const startOfDay = (ms: number): number => {
      const d = new Date(ms)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    const today = startOfDay(Date.now())
    const year = new Date(today).getFullYear()
    const buckets = new Map<string, { key: string; label: string; items: Entry[] }>()
    for (const entry of entries) {
      const day = startOfDay(entry.played_at)
      const date = new Date(day)
      const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
      const label =
        day === today
          ? '今天'
          : day === today - 86_400_000
            ? '昨天'
            : date.getFullYear() === year
              ? `${date.getMonth() + 1} 月 ${date.getDate()} 日`
              : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
      const bucket = buckets.get(key)
      if (bucket) bucket.items.push(entry)
      else buckets.set(key, { key, label, items: [entry] })
    }
    return [...buckets.values()]
  })()

  if (error) {
    return <EmptyState icon="alert" title="读取历史失败" detail={error} action={null} />
  }
  if (entries === null) return <BiliLoader label="正在取历史…" />
  if (entries.length === 0) {
    return (
      <EmptyState
        mascot="heart"
        icon="clock"
        title="还没有播放记录"
        detail="播过的歌会自动出现在这里，下次一定。"
        action={null}
      />
    )
  }

  return (
    <div
      ref={scrollerRef}
      id="scroll-main"
      onScroll={(event) => {
        historyMemory.scrollTop = event.currentTarget.scrollTop
      }}
      onFocusCapture={(event) => {
        historyMemory.focusKey =
          (event.target as HTMLElement).closest<HTMLElement>('[data-history-row]')?.dataset.key ?? null
      }}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <div className="mb-4 flex items-center justify-between">
        <PageTitle>历史记录</PageTitle>
        {confirmingClear ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-3)]">清空后无法恢复</span>
            <button
              type="button"
              onClick={() => void clearAll()}
              className="bili-press rounded-[6px] bg-[var(--danger)] px-3 py-1 text-[13px] text-white hover:opacity-90"
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              className="bili-press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[13px] text-[var(--text-2)] hover:text-[var(--text-1)]"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="bili-press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            清空历史
          </button>
        )}
      </div>

      {groups.map((group) => (
        <section key={group.key} className="mb-6">
          <div className="mb-3">
            <h2 className="text-[15px] font-medium text-[var(--text-1)]">{group.label}</h2>
          </div>
          <div className="border-t border-hairline">
            {group.items.map((entry, index) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                active={entry.track.key === snapshot?.track?.key}
                playing={snapshot?.phase === 'playing'}
                onPlay={() => {
                  const keys = group.items.map((item) => item.track.key)
                  void usePlayerStore
                    .getState()
                    .playContext(keys, index)
                    .then(() => {
                      const resumeAt = resumablePosition(entry)
                      if (resumeAt === null) return
                      if (usePlayerStore.getState().snapshot?.track?.key !== entry.track.key) return
                      void usePlayerStore.getState().seek(resumeAt)
                    })
                }}
                onDelete={() => void removeOne(entry.track.key)}
              />
            ))}
          </div>
        </section>
      ))}
      {hasMore ? (
        <div className="flex justify-center pb-6 pt-1">
          <button
            type="button"
            onClick={() => void loadOlder()}
            disabled={loadingMore}
            className="bili-press rounded-[6px] border border-[var(--line)] px-4 py-2 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            {loadingMore ? '加载中…' : '加载更早记录'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function HistoryRow({
  entry,
  active,
  playing,
  onPlay,
  onDelete,
}: {
  entry: Entry
  active: boolean
  playing: boolean
  onPlay: () => void
  onDelete: () => void
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const title = entry.track.title

  return (
    <article
      data-history-row
      data-key={entry.track.key}
      data-played-at={entry.played_at}
      data-position-ms={entry.position_ms}
      aria-current={active ? 'true' : undefined}
      className={[
        'group flex items-center gap-3 border-b border-hairline px-2 py-3 transition-colors hover:bg-[var(--ga0)]',
        active ? 'bg-[var(--accent-soft)]' : '',
      ].join(' ')}
    >
      <time className="num hidden w-12 shrink-0 font-mono text-[12px] text-[var(--text-2)] sm:block">
        {playedClock(entry.played_at)}
      </time>
      <button
        type="button"
        tabIndex={-1}
        onClick={onPlay}
        aria-label={`继续播放 ${title}`}
        title={`继续播放 ${title}`}
        className="relative h-12 w-20 shrink-0 overflow-hidden rounded-[4px] border border-[var(--line)] sm:h-[54px] sm:w-24"
      >
        <Cover cover={entry.track.cover} title={title} width={192} className="h-full w-full" />
      </button>
      <div className="min-w-0 flex-1">
        <time className="num mb-0.5 block font-mono text-[11px] text-[var(--text-3)] sm:hidden">
          {playedClock(entry.played_at)}
        </time>
        <button
          type="button"
          data-history-play
          onClick={onPlay}
          aria-label={`继续播放 ${title}`}
          className={[
            'block w-full truncate text-left text-[14px]',
            active ? 'text-[var(--accent)]' : 'text-[var(--text-1)] group-hover:text-[var(--accent-strong)]',
          ].join(' ')}
          title={title}
        >
          {title}
        </button>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-2)]">
          <span className="truncate">{entry.track.artist}</span>
          {active && playing ? <span className="shrink-0 text-[var(--accent)]">正在播放</span> : null}
        </div>
        <div className="sm:hidden">
          <HistoryProgress entry={entry} />
        </div>
      </div>
      <div className="hidden w-[140px] shrink-0 sm:block">
        <HistoryProgress entry={entry} />
      </div>
      <button
        type="button"
        aria-label={`更多操作 ${title}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title="更多操作"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ left: rect.right - 150, top: rect.bottom + 4, anchorTop: rect.top })
        }}
        className="t press -mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]"
      >
        <span aria-hidden className="text-[16px] leading-none">⋯</span>
      </button>
      <AnchoredPanel anchor={anchor} onClose={() => setAnchor(null)} label="历史记录操作" width={160}>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setAnchor(null)
            onDelete()
          }}
          className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--panel-raised)]"
        >
          <Icon name="close" size={13} />
          删除这条记录
        </button>
      </AnchoredPanel>
    </article>
  )
}

function HistoryProgress({ entry }: { entry: Entry }) {
  const position = entry.position_ms
  if (!(position > 0)) return null
  const duration = entry.track.duration_ms ?? 0
  const ratio = duration > 0 ? Math.min(1, position / duration) : null
  return (
    <div className="mt-1.5 min-w-0">
      <div className="num text-[12px] text-[var(--text-2)]">
        {finishedEntry(entry) ? '已播完' : `播至 ${formatTime(position)}`}
      </div>
      {ratio !== null ? (
        <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--line)]">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${ratio * 100}%` }} />
        </div>
      ) : null}
    </div>
  )
}

/** 进度落在尾部 1 秒内才算播完；没有总时长就没有完成依据。 */
function finishedEntry(entry: Entry): boolean {
  const duration = entry.track.duration_ms ?? 0
  return duration > 0 && entry.position_ms >= duration - 1_000
}

/** 播完的记录再点一次从头播，不要一进来就直接结束。 */
function resumablePosition(entry: Entry): number | null {
  if (!(entry.position_ms > 0) || finishedEntry(entry)) return null
  return entry.position_ms
}

function playedClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
