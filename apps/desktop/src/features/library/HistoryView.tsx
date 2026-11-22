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
  const focusPending = useRef(restored)
  /** 回来时要落到的位置。刷新第一页会重排列表，不能让它把这次恢复冲掉。 */
  const restoreScrollTop = useRef(restored ? historyMemory.scrollTop : 0)
  const restoreScrollPending = useRef(restored)
  const entriesRef = useRef<Entry[]>(historyMemory.entries)
  const hasMoreRef = useRef(historyMemory.hasMore)
  /** 删掉当前焦点所在的一行之后，把焦点交给下一行；null 表示没有相邻行。 */
  const focusRequest = useRef<{ key: string | null } | null>(null)
  /** 回到历史时把上次看的那一行放回视口顶部，不依赖滚动事件有没有送达。 */
  const restoreScroll = (box: HTMLElement): void => {
    const key = historyMemory.focusKey
    if (key) focusRow(box, key, 'anchor')
    else box.scrollTop = restoreScrollTop.current
    historyMemory.scrollTop = box.scrollTop
  }

  const applyFirstPage = async (list: Entry[]): Promise<void> => {
    // 回来时先刷新第一页：这段时间播过的新歌、改过的进度都要反映出来。
    // 旧尾巴只有在和第一页接得上时才拼回去，中间隔着新记录就宁可重来。
    const remembered = entriesRef.current
    const merged = await mergeFirstPage(remembered, list)
    if (merged === null) {
      setEntries(list)
      const last = list[list.length - 1]
      setCursor(last ? { played_at: last.played_at, id: last.id } : null)
      setHasMore(list.length === HISTORY_PAGE)
      return
    }
    setEntries(merged)
    const last = merged[merged.length - 1]
    setCursor(last ? { played_at: last.played_at, id: last.id } : null)
    setHasMore(merged.length > list.length ? hasMoreRef.current : list.length === HISTORY_PAGE)
  }

  useEffect(() => {
    let cancelled = false
    void ipc
      .libraryHistoryTimed(HISTORY_PAGE)
      .then((list) => {
        if (!cancelled) void applyFirstPage(list)
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
    entriesRef.current = entries ?? []
    hasMoreRef.current = hasMore
  }, [entries, cursor, hasMore])

  useLayoutEffect(() => {
    const box = scrollerRef.current
    if (!box) return
    if (focusPending.current) {
      focusPending.current = false
      restoreScroll(box)
      return
    }
    // 刷新第一页会换掉一批行，列表高度变化可能把 scrollTop 夹回 0；提交后再落一次。
    if (!restoreScrollPending.current) return
    restoreScrollPending.current = false
    restoreScroll(box)
  }, [entries])

  useLayoutEffect(() => {
    const request = focusRequest.current
    const box = scrollerRef.current
    if (!request || !box) return
    focusRequest.current = null
    focusRow(box, request.key, 'reveal')
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
      const list = entries ?? []
      const index = list.findIndex((entry) => entry.track.key === key)
      const next = list.filter((e) => e.track.key !== key)
      focusRequest.current = { key: next[index]?.track.key ?? next[index - 1]?.track.key ?? null }
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
      focusRequest.current = null
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
      <div
        ref={(node) => {
          if (!node) return
          // 删到一条不剩时列表整块消失，把焦点收到空态上，键盘用户不会掉出内容。
          if (focusRequest.current) {
            focusRequest.current = null
            node.focus()
          }
        }}
        tabIndex={-1}
        className="outline-none"
      >
        <EmptyState
          mascot="heart"
          icon="clock"
          title="还没有播放记录"
          detail="播过的歌会自动出现在这里，下次一定。"
          action={null}
        />
      </div>
    )
  }

  return (
    <div
      ref={scrollerRef}
      id="scroll-main"
      tabIndex={-1}
      onScroll={(event) => {
        historyMemory.scrollTop = event.currentTarget.scrollTop
      }}
      onFocusCapture={(event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>('[data-history-row]')?.dataset.key
        // 焦点停在「加载更早记录」这类控件上时，保留上一行的锚点。
        if (key) historyMemory.focusKey = key
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
                      // 这一条刚被播过，played_at 和进度都变了；把第一页拉回来，
                      // 它会按真实记录挪到「今天」。
                      // 历史由引擎的 watchdog 写入，等它落库再拉一次，并盯住这一行。
                      window.setTimeout(() => {
                        focusRequest.current = { key: entry.track.key }
                        void ipc
                          .libraryHistoryTimed(HISTORY_PAGE)
                          .then(applyFirstPage)
                          .catch(() => {})
                      }, 900)
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const deleteRef = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(false)
  const title = entry.track.title
  const action = finishedEntry(entry) ? '从头播放' : '继续播放'

  useEffect(() => {
    if (anchor) {
      wasOpen.current = true
      // 面板是 fixed 定位，聚焦不能顺手把整页滚一下：那会立刻触发面板的滚动关闭。
      deleteRef.current?.focus({ preventScroll: true })
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    // 菜单关了，焦点跟着回到触发按钮，键盘用户不会掉到页面顶部。
    triggerRef.current?.focus()
  }, [anchor])

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
      <div
        onClick={onPlay}
        title={`${action} ${title}`}
        className="relative h-12 w-20 shrink-0 cursor-pointer overflow-hidden rounded-[4px] border border-[var(--line)] sm:h-[54px] sm:w-24"
      >
        <Cover cover={entry.track.cover} title={title} width={192} className="h-full w-full" />
      </div>
      <div className="min-w-0 flex-1">
        <time className="num mb-0.5 block font-mono text-[11px] text-[var(--text-3)] sm:hidden">
          {playedClock(entry.played_at)}
        </time>
        <button
          type="button"
          data-history-play
          onClick={onPlay}
          aria-label={`${action} ${title}`}
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
        ref={triggerRef}
        type="button"
        aria-label={`更多操作 ${title}`}
        aria-haspopup="dialog"
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
          ref={deleteRef}
          type="button"
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

/** 焦点优先回到原来那一行；行没了就落到第一行，别让键盘用户掉出列表。 */
function focusRow(box: HTMLElement, key: string | null, mode: 'anchor' | 'reveal'): void {
  const rows = [...box.querySelectorAll<HTMLElement>('[data-history-row]')]
  const row = key ? rows.find((element) => element.dataset.key === key) : undefined
  const scope = row ?? rows[0]
  const target = scope?.querySelector<HTMLElement>('button[data-history-play]')
  if (!scope || !target) {
    box.focus({ preventScroll: true })
    return
  }
  historyMemory.focusKey = scope.dataset.key ?? null
  target.focus({ preventScroll: true })
  const offset = scope.getBoundingClientRect().top - box.getBoundingClientRect().top
  if (mode === 'anchor') {
    box.scrollTop += offset - 8
  } else if (offset < 0 || offset + scope.offsetHeight > box.clientHeight) {
    box.scrollTop += offset - Math.max(8, Math.round(box.clientHeight / 3))
  }
  historyMemory.scrollTop = box.scrollTop
}

/**
 * 重进历史时用新取的第一页替换顶部，已经翻出来的更早记录接在后面。
 * 第一页都取不满说明库里没有更多了，旧尾巴一并丢掉。
 */
async function mergeFirstPage(older: Entry[], fresh: Entry[]): Promise<Entry[] | null> {
  if (older.length === 0 || fresh.length < HISTORY_PAGE) return fresh
  if (older.length <= fresh.length) return fresh
  const last = fresh[fresh.length - 1]
  if (!last) return fresh
  const seen = new Set(fresh.map((entry) => entry.track.key))
  const tail = older.filter(
    (entry) =>
      !seen.has(entry.track.key) &&
      (entry.played_at < last.played_at || (entry.played_at === last.played_at && entry.id < last.id)),
  )
  const head = tail[0]
  if (!head) return fresh
  // 只看新旧顺序不够：离开期间可能又播了超过一页，旧尾巴跟第一页之间会断层。
  // 用第一页最后一条取下一页，和旧尾巴的头对上了才敢拼。
  const next = await ipc.libraryHistoryTimed(HISTORY_PAGE, { played_at: last.played_at, id: last.id })
  if (!next.some((entry) => entry.id === head.id)) return null
  return [...fresh, ...tail]
}
