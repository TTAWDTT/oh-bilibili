import type { Track } from '../shared/lib/contract'
import { create } from 'zustand'

export type View =
  | { kind: 'home' }
  | { kind: 'ranking'; rid?: number }
  | { kind: 'search' }
  | { kind: 'library' }
  | { kind: 'playlist'; id: number; name: string }
  | { kind: 'liked' }
  | { kind: 'downloads' | 'history' | 'favs' }
  | { kind: 'author'; name: string; mid?: number | null }
  | { kind: 'watch'; track: Track }
  | { kind: 'watchLater' }
  | { kind: 'following' }
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
  /**
   * 观看页的「沉浸」布局：隐藏应用外壳，画面占满窗口。
   * 网页全屏与全屏都会打开它，区别只在窗口要不要进系统全屏。
   */
  cinema: boolean
  /** 窗口是否进系统全屏。只有「全屏」把它打开，「网页全屏」不动窗口。 */
  osFullscreen: boolean
  /** 搜索页要预填的作者名。点 UP 主时写入，搜索页消费后清空。 */
  authorQuery: string | null
  toasts: Toast[]
  /** 当前视图之前去过哪里。返回按钮用它，不再写死跳某一页。 */
  history: View[]
  navigate: (view: View) => void
  /** 回上一层；没有历史就回发现页。 */
  goBack: () => void
  setRail: (tab: RailTab | null) => void
  toggleRail: (tab: RailTab) => void
  closeRail: () => void
  focusSearch: () => void
  setHeroQuery: (q: string | null) => void
  setCurrentQuery: (q: string) => void
  setSearchFilters: (partition: string, order: string, duration?: number) => void
  setAuthOpen: (open: boolean) => void
  setStage: (open: boolean) => void
  setCinema: (on: boolean) => void
  setOsFullscreen: (on: boolean) => void
  setAuthorQuery: (q: string | null) => void
  pushToast: (tone: ToastTone, title: string, detail: string | null) => void
  dismissToast: (id: number) => void
}

export const useAppStore = create<AppStore>()((set, get) => ({
  view: { kind: 'home' },
  history: [],
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
  cinema: false,
  osFullscreen: false,
  authorQuery: null,
  toasts: [],
  navigate: (view) =>
    set((state) => {
      // 同一个视图重复点不算一次前进，否则「返回」要按很多次才动。
      if (state.view.kind === view.kind && JSON.stringify(state.view) === JSON.stringify(view)) {
        return {}
      }
      return { view, cinema: false, osFullscreen: false, history: [...state.history, state.view].slice(-32) }
    }),
  goBack: () =>
    set((state) => {
      const prev = state.history.at(-1)
      if (!prev) return { view: { kind: 'home' }, cinema: false, osFullscreen: false }
      return { view: prev, cinema: false, osFullscreen: false, history: state.history.slice(0, -1) }
    }),
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
  setCinema: (on) => set({ cinema: on }),
  setOsFullscreen: (on) => set({ osFullscreen: on }),
  setAuthorQuery: (q) => set({ authorQuery: q }),
  pushToast: (tone, title, detail) => {
    toastSeq += 1
    const toast: Toast = { id: toastSeq, tone, title, detail }
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }))
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
