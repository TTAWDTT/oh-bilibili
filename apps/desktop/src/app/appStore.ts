import { create } from 'zustand'

export type View =
  | { kind: 'search' }
  | { kind: 'library' }
  | { kind: 'playlist'; id: number; name: string }
  | { kind: 'liked' }
  | { kind: 'downloads' }
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
  authOpen: boolean
  mv: { key: string; title: string } | null
  toasts: Toast[]
  navigate: (view: View) => void
  setRail: (tab: RailTab | null) => void
  toggleRail: (tab: RailTab) => void
  closeRail: () => void
  focusSearch: () => void
  setAuthOpen: (open: boolean) => void
  setMv: (mv: { key: string; title: string } | null) => void
  pushToast: (tone: ToastTone, title: string, detail: string | null) => void
  dismissToast: (id: number) => void
}

export const useAppStore = create<AppStore>()((set, get) => ({
  view: { kind: 'search' },
  // 默认收起：没在播放时右栏没有内容，让它占宽度就是把中间白白挤窄。
  rail: null,
  searchFocus: 0,
  authOpen: false,
  mv: null,
  toasts: [],
  navigate: (view) => set({ view }),
  setRail: (tab) => set({ rail: tab }),
  toggleRail: (tab) => set({ rail: get().rail === tab ? null : tab }),
  closeRail: () => set({ rail: null }),
  focusSearch: () => set((state) => ({ view: { kind: 'search' }, searchFocus: state.searchFocus + 1 })),
  setAuthOpen: (open) => set({ authOpen: open }),
  setMv: (mv) => set({ mv }),
  pushToast: (tone, title, detail) => {
    toastSeq += 1
    const toast: Toast = { id: toastSeq, tone, title, detail }
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }))
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
