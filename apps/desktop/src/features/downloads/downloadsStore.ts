import { create } from 'zustand'
import type { DownloadView } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { toastDone, toastFailure } from '../../app/notice'

type DownloadsStore = {
  items: DownloadView[] | null
  pending: ReadonlySet<string>
  load: () => Promise<void>
  enqueue: (key: string) => Promise<void>
  retry: (key: string) => Promise<void>
  upsert: (view: DownloadView) => void
}

function merge(items: DownloadView[] | null, view: DownloadView): DownloadView[] {
  const list = items ?? []
  const index = list.findIndex((item) => item.key === view.key)
  if (index < 0) return [...list, view]
  return list.map((item, at) => (at === index ? view : item))
}

export const useDownloadsStore = create<DownloadsStore>()((set, get) => {
  const start = async (key: string, done: string): Promise<void> => {
    if (get().pending.has(key)) return
    set((state) => ({ pending: new Set(state.pending).add(key) }))
    try {
      const view = await ipc.downloadEnqueue(key)
      set((state) => ({ items: merge(state.items, view) }))
      toastDone(done, view.title)
    } catch (cause) {
      toastFailure('下载', cause)
    } finally {
      set((state) => {
        const pending = new Set(state.pending)
        pending.delete(key)
        return { pending }
      })
    }
  }

  return {
    items: null,
    pending: new Set(),
    load: async () => {
      try {
        set({ items: await ipc.downloadsList() })
      } catch (cause) {
        set({ items: [] })
        toastFailure('读取下载列表', cause)
      }
    },
    enqueue: (key) => start(key, '已加入下载队列'),
    retry: (key) => start(key, '已重新加入下载队列'),
    upsert: (view) => {
      set((state) => ({ items: merge(state.items, view) }))
    },
  }
})
