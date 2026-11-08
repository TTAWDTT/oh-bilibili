import { create } from 'zustand'
import type { Playlist } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { toastDone, toastFailure } from '../../app/notice'

type LibraryStore = {
  playlists: Playlist[] | null
  revision: number
  load: () => Promise<void>
  refresh: () => void
  create: (name: string) => Promise<Playlist | null>
  add: (playlist: Playlist, key: string) => Promise<boolean>
}

export const useLibraryStore = create<LibraryStore>()((set, get) => ({
  playlists: null,
  revision: 0,
  load: async () => {
    try {
      set({ playlists: await ipc.libraryPlaylists() })
    } catch (cause) {
      set({ playlists: [] })
      toastFailure('读取歌单', cause)
    }
  },
  refresh: () => {
    set((state) => ({ revision: state.revision + 1 }))
    void get().load()
  },
  create: async (name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      toastFailure('新建歌单', { class: 'input', message: '歌单名不能为空' })
      return null
    }
    try {
      const playlist = await ipc.libraryCreate(trimmed)
      set((state) => ({
        playlists: state.playlists === null ? [playlist] : [...state.playlists, playlist],
        revision: state.revision + 1,
      }))
      toastDone('歌单已创建', `《${playlist.name}》`)
      return playlist
    } catch (cause) {
      toastFailure('新建歌单', cause)
      return null
    }
  },
  add: async (playlist, key) => {
    try {
      await ipc.libraryAdd(playlist.id, key)
      set((state) => ({ revision: state.revision + 1 }))
      toastDone('已加入歌单', `《${playlist.name}》`)
      return true
    } catch (cause) {
      toastFailure('加入歌单', cause)
      return false
    }
  },
}))
