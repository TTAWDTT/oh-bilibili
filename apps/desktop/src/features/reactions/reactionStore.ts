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
  likedTracks: Track[]
  /** 从账号拉一次真实互动状态，把心/星点亮。未登录会抛 needs_login。 */
  hydrate: (keys: string[]) => Promise<void>
  toggleLike: (track: Track) => Promise<void>
  toggleFav: (track: Track) => Promise<void>
  /** 投币。成功后本地计数 +count，与账号一致。 */
  addCoin: (track: Track, count: number) => Promise<void>
  /** 收进指定收藏夹后把本地状态点亮点。 */
  favTo: (track: Track, folderId: number | null) => Promise<void>
}

export const useReactionStore = create<ReactionStore>()((set, get) => ({
  liked: {},
  faved: {},
  coins: {},
  known: {},
  likedTracks: [],
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
  toggleLike: async (track) => {
    const previous = get().liked[track.key] ?? false
    const previousTracks = get().likedTracks
    const next = !previous
    set((state) => ({
      liked: { ...state.liked, [track.key]: next },
      likedTracks: next
        ? [track, ...state.likedTracks.filter((item) => item.key !== track.key)]
        : state.likedTracks.filter((item) => item.key !== track.key),
    }))
    try {
      await ipc.likeSet(track.key, next)
    } catch (cause) {
      set((state) => ({ liked: { ...state.liked, [track.key]: previous }, likedTracks: previousTracks }))
      toastFailure(next ? '喜欢' : '取消喜欢', cause)
    }
  },
  addCoin: async (track, count) => {
    const previous = get().coins[track.key] ?? 0
    try {
      await ipc.coinAdd(track.key, count, true)
      // 投币不可撤销，只有成功才改本地
      set((state) => ({
        coins: { ...state.coins, [track.key]: Math.min(2, previous + count) },
        liked: { ...state.liked, [track.key]: true },
      }))
    } catch (cause) {
      reportActionError('投币', cause)
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
    set((state) => ({ faved: { ...state.faved, [track.key]: next } }))
    try {
      await ipc.favSet(track.key, next)
    } catch (cause) {
      set((state) => ({ faved: { ...state.faved, [track.key]: previous } }))
      toastFailure(next ? '收藏' : '取消收藏', cause)
    }
  },
}))
