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

/** 窄窗口默认收起右栏，否则内容区会被压到不成样子。 */
const DEFAULT_RAIL: RailTab | null =
  typeof window !== 'undefined' && window.matchMedia('(min-width: 1180px)').matches ? 'lyrics' : null

let toastSeq = 0

type AppStore = {
  view: View
  rail: RailTab | null
  authOpen: boolean
  toasts: Toast[]
  navigate: (view: View) => void
  toggleRail: (tab: RailTab) => void
  closeRail: () => void
  setAuthOpen: (open: boolean) => void
  pushToast: (tone: ToastTone, title: string, detail: string | null) => void
  dismissToast: (id: number) => void
}

export const useAppStore = create<AppStore>()((set, get) => ({
  view: { kind: 'search' },
  rail: DEFAULT_RAIL,
  authOpen: false,
  toasts: [],
  navigate: (view) => set({ view }),
  toggleRail: (tab) => set({ rail: get().rail === tab ? null : tab }),
  closeRail: () => set({ rail: null }),
  setAuthOpen: (open) => set({ authOpen: open }),
  pushToast: (tone, title, detail) => {
    toastSeq += 1
    const toast: Toast = { id: toastSeq, tone, title, detail }
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }))
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
