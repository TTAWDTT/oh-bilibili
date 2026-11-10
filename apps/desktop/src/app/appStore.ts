import type { Track } from '../shared/lib/contract'
import { create } from 'zustand'

export type View =
  | { kind: 'search' }
  | { kind: 'library' }
  | { kind: 'playlist'; id: number; name: string }
  | { kind: 'liked' }
  | { kind: 'downloads' | 'history' | 'favs' }
  | { kind: 'author'; name: string; mid?: number | null }
  | { kind: 'watch'; track: Track }
  | { kind: 'settings' }

export type RailTab = 'lyrics' | 'queue'
export type ToastTone = 'error' | 'warn' | 'info' | 'success'
export type Toast = { id: number; tone: ToastTone; title: string; detail: string | null }

let toastSeq = 0

type AppStore = {
  view: View
  rail: RailTab | null
  /** 每次 ⌘K 自增，搜索框据此主动抢焦点，不必把 ref 提到全局。 */
  searchFocus: number
  /** 顶栏搜索框提交的关键词，搜索页消费一次后清空。 */
  heroQuery: string | null
  /** 搜索页当前实际搜索的词。顶栏输入框跟着它走，两边不会各说各话。 */
  currentQuery: string
  /** 搜索页上次用的分区与排序，切走再回来要恢复。 */
  currentPartition: string
  currentOrder: string
  /** 时长筛选：0 不限，1~4 对应 B 站的 duration 参数。 */
  currentDuration: number
  authOpen: boolean
  mv: { key: string; title: string } | null
  stage: boolean
  /** 搜索页要预填的作者名。点 UP 主时写入，搜索页消费后清空。 */
  authorQuery: string | null
  toasts: Toast[]
  navigate: (view: View) => void
  setRail: (tab: RailTab | null) => void
  toggleRail: (tab: RailTab) => void
  closeRail: () => void
  focusSearch: () => void
  setHeroQuery: (q: string | null) => void
  setCurrentQuery: (q: string) => void
  setSearchFilters: (partition: string, order: string, duration?: number) => void
  setAuthOpen: (open: boolean) => void
  setStage: (open: boolean) => void
  setAuthorQuery: (q: string | null) => void
  pushToast: (tone: ToastTone, title: string, detail: string | null) => void
  dismissToast: (id: number) => void
}

export const useAppStore = create<AppStore>()((set, get) => ({
  view: { kind: 'search' },
  // 默认收起：没在播放时右栏没有内容，让它占宽度就是把中间白白挤窄。
  rail: null,
  searchFocus: 0,
  heroQuery: null,
  currentQuery: '',
  currentPartition: '全部',
  currentOrder: 'totalrank',
  currentDuration: 0,
  authOpen: false,
  mv: null,
  stage: false,
  authorQuery: null,
  toasts: [],
  navigate: (view) => set({ view }),
  setRail: (tab) => set({ rail: tab }),
  toggleRail: (tab) => set({ rail: get().rail === tab ? null : tab }),
  closeRail: () => set({ rail: null }),
  focusSearch: () => set((state) => ({ view: { kind: 'search' }, searchFocus: state.searchFocus + 1 })),
  setHeroQuery: (q) => set({ heroQuery: q, view: { kind: 'search' } }),
  setCurrentQuery: (q) => set({ currentQuery: q }),
  setSearchFilters: (partition, order, duration = 0) =>
    set({ currentPartition: partition, currentOrder: order, currentDuration: duration }),
  setAuthOpen: (open) => set({ authOpen: open }),
  setStage: (open) => set({ stage: open }),
  setAuthorQuery: (q) => set({ authorQuery: q }),
  pushToast: (tone, title, detail) => {
    toastSeq += 1
    const toast: Toast = { id: toastSeq, tone, title, detail }
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }))
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
