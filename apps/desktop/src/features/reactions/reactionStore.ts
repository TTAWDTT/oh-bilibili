import { create } from 'zustand'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { toastFailure } from '../../app/notice'
import { reportActionError } from '../../shared/lib/actionError'

type ReactionStore = {
  liked: Record<string, boolean>
  faved: Record<string, boolean>
  /** 已经投出去的币数（0/1/2）。B 站上限 2 枚。 */
  coins: Record<string, number>
  /** 已经从账号查过的 key，滚动时不再重复请求。 */
  known: Record<string, true>
  /** 从账号拉一次真实互动状态，把心/星点亮。未登录会抛 needs_login。 */
  hydrate: (keys: string[]) => Promise<void>
  /** 无视缓存重新查一次。详情页用：打开时看到的必须是真的。 */
  refresh: (keys: string[]) => Promise<void>
  /** 点赞/取消点赞。返回服务端确认后的新状态；失败返回 null。 */
  toggleLike: (track: Track) => Promise<boolean | null>
  toggleFav: (track: Track) => Promise<boolean | null>
  /** 投币。成功后本地计数 +count，与账号一致；返回是否真的成功。 */
  addCoin: (track: Track, count: number, alsoLike?: boolean) => Promise<boolean>
  /** 收进指定收藏夹后把本地状态点亮点。 */
  favTo: (track: Track, folderId: number | null) => Promise<void>
}

export const useReactionStore = create<ReactionStore>()((set, get) => ({
  liked: {},
  faved: {},
  coins: {},
  known: {},
  hydrate: async (keys) => {
    // 只查没查过的：列表越滚越长时，总请求数等于「看过的视频数」而不是「渲染次数」
    const fresh = keys.filter((k) => !get().known[k])
    if (fresh.length === 0) return
    const rows = await ipc.relationStates(fresh)
    set((state) => {
      const liked = { ...state.liked }
      const faved = { ...state.faved }
      const coins = { ...state.coins }
      const known = { ...state.known }
      for (const [key, isLiked, isFaved, coin] of rows) {
        liked[key] = isLiked
        faved[key] = isFaved
        coins[key] = coin
        known[key] = true
      }
      return { liked, faved, coins, known }
    })
  },
  refresh: async (keys) => {
    const rows = await ipc.relationStates(keys)
    set((state) => {
      const liked = { ...state.liked }
      const faved = { ...state.faved }
      const coins = { ...state.coins }
      const known = { ...state.known }
      for (const [key, isLiked, isFaved, coin] of rows) {
        liked[key] = isLiked
        faved[key] = isFaved
        coins[key] = coin
        known[key] = true
      }
      return { liked, faved, coins, known }
    })
  },
  toggleLike: async (track) => {
    const previous = get().liked[track.key] ?? false
    const next = !previous
    // 先请求，成功了再改本地状态。
    //
    // 早先是乐观更新：先点亮再发请求，失败再回滚。可是这条写路径会被服务端拒
    // （实测返回 65006 / -400），而回滚在某些时序下没跑到，界面就一直亮着——
    // 用户看到的是「已点赞」，服务端根本没记上。宁可点下去有半秒延迟，
    // 也不要让界面撒谎。
    try {
      await ipc.likeSet(track.key, next)
    } catch (cause) {
      toastFailure(next ? '喜欢' : '取消喜欢', cause)
      return null
    }
    set((state) => ({
      liked: { ...state.liked, [track.key]: next },
    }))
    return next
  },
  addCoin: async (track, count, alsoLike = true) => {
    const previous = get().coins[track.key] ?? 0
    try {
      await ipc.coinAdd(track.key, count, alsoLike)
      // 投币不可撤销，只有成功才改本地
      set((state) => ({
        coins: { ...state.coins, [track.key]: Math.min(2, previous + count) },
        liked: alsoLike ? { ...state.liked, [track.key]: true } : state.liked,
      }))
      return true
    } catch (cause) {
      reportActionError('投币', cause)
      return false
    }
  },
  favTo: async (track, folderId) => {
    try {
      await ipc.favSet(track.key, true, folderId)
      set((state) => ({ faved: { ...state.faved, [track.key]: true } }))
    } catch (cause) {
      reportActionError('收藏', cause)
      throw cause
    }
  },
  toggleFav: async (track) => {
    const previous = get().faved[track.key] ?? false
    const next = !previous
    try {
      await ipc.favSet(track.key, next)
    } catch (cause) {
      toastFailure(next ? '收藏' : '取消收藏', cause)
      return null
    }
    set((state) => ({ faved: { ...state.faved, [track.key]: next } }))
    return next
  },
}))
