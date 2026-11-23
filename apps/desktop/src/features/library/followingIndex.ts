import { useCallback, useEffect, useRef, useState } from 'react'
import type { Followed, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'

type Snapshot = {
  items: Followed[]
  total: number
  complete: boolean
  /** 下一次从第几页继续。失败时停在缺的那页。 */
  nextPage: number
  failedPage: number | null
  at: number
}

/** 一个账号只建一次索引：离开目录再回来还从原处接着读，不重新扫全量。 */
const cache = new Map<number, Snapshot>()

/**
 * 已经读到的关注名单快照。动态页只需要一份头像列表，不该为此再发一次
 * 分页请求——限流时那次失败会让筛选条整条消失。
 */
export function cachedFollowing(accountMid: number | null): Followed[] | null {
  if (accountMid == null) return null
  const hit = cache.get(accountMid)
  return hit && hit.items.length > 0 ? hit.items : null
}

export type FollowingIndexState = {
  items: Followed[]
  total: number
  complete: boolean
  loading: boolean
  failedPage: number | null
  error: WireError | null
  retry: () => void
  refresh: () => void
}

const EMPTY: Omit<FollowingIndexState, 'retry' | 'refresh'> = {
  items: [],
  total: 0,
  complete: false,
  loading: false,
  failedPage: null,
  error: null,
}

/**
 * 按账号读取全部关注，建一份按 mid 去重的本地索引。
 *
 * 搜索不要求用户先滚到底，所以这里一页接一页把名单读完；先到的页已经能搜，
 * 没读完时界面上会标出已读范围。某一页失败就停在缺页，保留已读到的人，
 * 重试从缺页继续。账号、请求批次变了，旧响应一律丢掉。
 */
export function useFollowingIndex(accountMid: number | null, enabled: boolean): FollowingIndexState {
  const [state, setState] = useState<Omit<FollowingIndexState, 'retry' | 'refresh'>>(EMPTY)
  const midRef = useRef(accountMid)
  midRef.current = accountMid
  const epochRef = useRef(0)
  const loadingRef = useRef(false)
  const itemsRef = useRef(new Map<number, Followed>())
  const totalRef = useRef(0)
  const nextRef = useRef(1)
  const failedRef = useRef<number | null>(null)

  const loadFrom = useCallback(async (start: number, epoch: number): Promise<void> => {
    if (loadingRef.current) return
    loadingRef.current = true
    failedRef.current = null
    setState((prev) => ({ ...prev, loading: true, error: null, failedPage: null }))
    let page = Math.max(1, start)
    const owner = midRef.current
    try {
      for (;;) {
        const [list, total] = await ipc.following(page)
        if (epochRef.current !== epoch || midRef.current !== owner) return
        totalRef.current = total
        for (const user of list) itemsRef.current.set(user.mid, user)
        const items = [...itemsRef.current.values()]
        const complete = list.length === 0 || items.length >= total
        nextRef.current = page + 1
        setState({
          items,
          total,
          complete,
          loading: !complete,
          failedPage: null,
          error: null,
        })
        const mid = midRef.current
        if (mid != null) {
          cache.set(mid, {
            items,
            total,
            complete,
            nextPage: nextRef.current,
            failedPage: null,
            at: Date.now(),
          })
        }
        if (complete) break
        page += 1
      }
    } catch (cause) {
      if (epochRef.current !== epoch || midRef.current !== owner) return
      const error = toWireError(cause)
      if (page === 1) {
        setState({ ...EMPTY, error })
      } else {
        failedRef.current = page
        nextRef.current = page
        setState({
          items: [...itemsRef.current.values()],
          total: totalRef.current,
          complete: false,
          loading: false,
          failedPage: page,
          error: null,
        })
        const mid = midRef.current
        if (mid != null) {
          cache.set(mid, {
            items: [...itemsRef.current.values()],
            total: totalRef.current,
            complete: false,
            nextPage: page,
            failedPage: page,
            at: Date.now(),
          })
        }
      }
    } finally {
      if (epochRef.current === epoch && midRef.current === owner) loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const epoch = ++epochRef.current
    loadingRef.current = false
    const cached = accountMid == null ? undefined : cache.get(accountMid)
    itemsRef.current = new Map((cached?.items ?? []).map((user) => [user.mid, user]))
    totalRef.current = cached?.total ?? 0
    nextRef.current = cached?.nextPage ?? 1
    failedRef.current = cached?.failedPage ?? null
    setState({
      items: cached?.items ?? [],
      total: cached?.total ?? 0,
      complete: cached?.complete ?? false,
      loading: false,
      failedPage: cached?.failedPage ?? null,
      error: null,
    })
    // 完整缓存直接交给界面用；要拿最新名单走「刷新」。
    if (accountMid != null && cached?.complete) return
    void loadFrom(cached?.nextPage ?? 1, epoch)
    return () => {
      epochRef.current += 1
    }
  }, [accountMid, enabled, loadFrom])

  useEffect(() => {
    return () => {
      epochRef.current += 1
    }
  }, [])

  const retry = useCallback((): void => {
    void loadFrom(failedRef.current ?? nextRef.current, epochRef.current)
  }, [loadFrom])

  const refresh = useCallback((): void => {
    const mid = midRef.current
    if (mid == null) return
    cache.delete(mid)
    const epoch = ++epochRef.current
    loadingRef.current = false
    itemsRef.current = new Map()
    totalRef.current = 0
    nextRef.current = 1
    failedRef.current = null
    setState(EMPTY)
    void loadFrom(1, epoch)
  }, [loadFrom])

  return { ...state, retry, refresh }
}
