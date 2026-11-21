import { Icon } from '../../shared/ui/Icon'
import { reportActionError } from '../../shared/lib/actionError'
import { toastDone } from '../../app/notice'
import { useEffect, useState } from 'react'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { PageTitle } from '../../shared/ui/PageTitle'

const HISTORY_PAGE = 60

/**
 * 播放历史。数据来自 SQLite 的 history 表，是真正播过的记录。
 *
 * 伪造一份「最近播放」很容易，但那不是历史——历史必须由播放动作写入。
 */
export function HistoryView() {
  const [entries, setEntries] = useState<import('../../shared/lib/ipc').HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const snapshot = usePlayerStore((state) => state.snapshot)

  useEffect(() => {
    let cancelled = false
    void ipc
      .libraryHistoryTimed(HISTORY_PAGE, 0)
      .then((list) => {
        if (cancelled) return
        setEntries(list)
        setHasMore(list.length === HISTORY_PAGE)
      })
      .catch((e) => {
        if (!cancelled) setError(toWireError(e).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** 再取一页更早的记录。offset 用已挂出来的条数，删掉已加载的记录会自然对齐。 */
  const loadOlder = async (): Promise<void> => {
    if (!entries || entries.length === 0 || loadingMore) return
    setLoadingMore(true)
    try {
      const older = await ipc.libraryHistoryTimed(HISTORY_PAGE, entries.length)
      setEntries((prev) => [...(prev ?? []), ...older])
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
      setEntries((prev) => (prev ?? []).filter((e) => e.track.key !== key))
    } catch (e) {
      reportActionError('删除记录', e)
    }
  }

  /** 清空全部历史。 */
  const clearAll = async (): Promise<void> => {
    try {
      await ipc.historyClear()
      setEntries([])
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
      id="scroll-main"
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
        <section key={group.key} className="mb-8">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[15px] font-medium text-[var(--text-1)]">{group.label}</h2>
            <span className="num text-[12px] text-[var(--text-3)]">{group.items.length} 个</span>
          </div>
          <ContentGrid
            tracks={group.items.map((e) => e.track)}
            activeKey={snapshot?.track?.key ?? null}
            playing={snapshot?.phase === 'playing'}
            progress={(track) => {
              const entry = group.items.find((e) => e.track.key === track.key)
              const duration = track.duration_ms
              if (!entry || !duration || entry.position_ms <= 0) return null
              return entry.position_ms / duration
            }}
            extraAction={(track) => (
              <button
                type="button"
                aria-label={`删除 ${track.title} 的播放记录`}
                title="删除这条记录"
                onClick={() => void removeOne(track.key)}
                className="bili-icon-hover text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          />
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
