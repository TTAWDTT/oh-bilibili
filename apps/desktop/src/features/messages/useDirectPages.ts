import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirectPage } from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { useAppStore } from '../../app/appStore'

type Page<T> = DirectPage<T> & { latest_seqno?: string | null; latest_at?: number | null }
type PageState<T> = { items: T[]; next: string | null; loaded: boolean; latestSeq: string | null; latestAt: number | null }

/** 会话按最近联系排在前面，聊天记录按时间从旧到新。 */
export function useDirectPages<T extends { at: number }>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  keyOf: (item: T) => number | string,
  newestFirst: boolean,
  applyUpdates?: (items: T[]) => T[],
) {
  const [page, setPage] = useState<PageState<T>>({ items: [], next: null, loaded: false, latestSeq: null, latestAt: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; cursor: string | null } | null>(null)
  const pending = useRef(false)
  const generation = useRef(0)

  const merge = useCallback((old: T[], incoming: T[], first: boolean) => {
    const keys = new Set(incoming.map(keyOf))
    const rest = old.filter((item) => !keys.has(keyOf(item)))
    const items = first ? [...incoming, ...rest] : [...rest, ...incoming]
    items.sort((a, b) => newestFirst ? b.at - a.at : a.at - b.at)
    return applyUpdates ? applyUpdates(items) : items
  }, [keyOf, newestFirst, applyUpdates])

  const load = useCallback(async (cursor: string | null) => {
    if (pending.current) return
    pending.current = true
    const ticket = generation.current
    setBusy(true)
    try {
      const result = await fetchPage(cursor)
      if (generation.current !== ticket) return
      setPage((old) => {
        const keys = new Set(result.items.map(keyOf))
        const overlap = cursor === null && old.items.some((item) => keys.has(keyOf(item)))
        // 离开期间若新消息超过一页，用新游标补齐中间的记录。
        return {
          items: merge(old.items, result.items, newestFirst === (cursor === null)),
          next: overlap ? old.next : result.next_cursor,
          latestSeq: cursor === null ? result.latest_seqno ?? null : old.latestSeq,
          latestAt: cursor === null ? result.latest_at ?? null : old.latestAt,
          loaded: true,
        }
      })
      setError(null)
    } catch (cause) {
      if (generation.current !== ticket) return
      const failure = toWireError(cause)
      if (failure.class === 'needs_login') useAppStore.getState().setAuthOpen(true)
      setError({ message: failure.message, cursor })
    } finally {
      if (generation.current === ticket) {
        pending.current = false
        setBusy(false)
      }
    }
  }, [fetchPage, keyOf, merge, newestFirst])

  useEffect(() => {
    void load(null)
    const refreshVisible = () => { if (!document.hidden) void load(null) }
    const timer = window.setInterval(refreshVisible, 30_000)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      generation.current++
      pending.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [load])

  const addLatest = (item: T) => setPage((old) => ({ ...old, items: merge(old.items, [item], newestFirst) }))
  const updateItem = useCallback((key: number | string, change: (item: T) => T) => {
    setPage((old) => ({ ...old, items: old.items.map((item) => keyOf(item) === key ? change(item) : item) }))
  }, [keyOf])
  return { ...page, busy, error, load, addLatest, updateItem }
}
