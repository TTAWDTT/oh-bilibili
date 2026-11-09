import { create } from 'zustand'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { toastFailure } from '../../app/notice'

type ReactionStore = {
  liked: Record<string, boolean>
  faved: Record<string, boolean>
  likedTracks: Track[]
  /** 从账号拉一次真实互动状态，把心/星点亮。未登录会抛 needs_login。 */
  hydrate: (keys: string[]) => Promise<void>
  toggleLike: (track: Track) => Promise<void>
  toggleFav: (track: Track) => Promise<void>
}

export const useReactionStore = create<ReactionStore>()((set, get) => ({
  liked: {},
  faved: {},
  likedTracks: [],
  hydrate: async (keys) => {
    if (keys.length === 0) return
    const rows = await ipc.relationStates(keys)
    set((state) => {
      const liked = { ...state.liked }
      const faved = { ...state.faved }
      for (const [key, isLiked, isFaved] of rows) {
        liked[key] = isLiked
        faved[key] = isFaved
      }
      return { liked, faved }
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
