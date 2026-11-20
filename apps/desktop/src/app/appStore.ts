import type { Track } from '../shared/lib/contract'
import type { MessageUnread } from '../shared/lib/ipc'
import { create } from 'zustand'

export type View =
  | { kind: 'home' }
  | { kind: 'dynamic' }
  | { kind: 'messages' }
  | { kind: 'ranking'; rid?: number }
  | { kind: 'popular' }
  | { kind: 'precious' }
  | { kind: 'weekly' }
  | { kind: 'live' }
  | { kind: 'bangumi' }
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
export type SidebarMode = 'full' | 'rail'
export type ToastTone = 'error' | 'warn' | 'info' | 'success'
export type Toast = { id: number; tone: ToastTone; title: string; detail: string | null }

let toastSeq = 0

let pendingGlide: Map<HTMLElement, DOMRect> | null = null
let glideAnimations: Animation[] = []

/**
 * 侧边栏换宽度会让整个网格重排一次，可见卡片的位置跟着变。
 * 先记下旧位置，等新布局提交后再补一段位移动画。
 *
 * 旧位置必须在点下去的这一帧读，不能在 React 提交之后读；动画则必须等
 * 提交后、绘制前启动，所以分成 capture 和 glide 两步。
 */
function captureCards(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const scroller = document.getElementById('scroll-main')
  if (!scroller) return
  const before = new Map<HTMLElement, DOMRect>()
  for (const card of scroller.querySelectorAll<HTMLElement>('article[data-track-card]')) {
    const rect = card.getBoundingClientRect()
    if (rect.bottom > 0 && rect.top < window.innerHeight) before.set(card, rect)
  }
  pendingGlide = before.size > 0 ? before : null
}

/** 在新布局提交后、绘制前调用：把卡片从旧位置滑回新位置。 */
export function glideCards(): void {
  const before = pendingGlide
  pendingGlide = null
  if (!before) return
  for (const animation of glideAnimations) animation.cancel()
  glideAnimations = []
  for (const [card, oldRect] of before) {
    if (!card.isConnected) continue
    const rect = card.getBoundingClientRect()
    const dx = oldRect.left - rect.left
    const dy = oldRect.top - rect.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    // WAAPI 的 transform 动画走合成器，主线程忙着重排时也不会掉帧。
    glideAnimations.push(
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 180, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
      ),
    )
  }
}

/** 左栏收起状态跟着窗口走：关掉再打开还是上次那种宽度。 */
const SIDEBAR_KEY = 'oh-bilibili:sidebar'

function loadSidebar(): SidebarMode {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'rail' ? 'rail' : 'full'
  } catch {
    return 'full'
  }
}

function saveSidebar(mode: SidebarMode): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, mode)
  } catch {
    // 隐私模式写不进去，按当前会话生效即可
  }
}

type AppStore = {
  view: View
  rail: RailTab | null
  /** 每次 ⌘K 自增，搜索框据此主动抢焦点，不必把 ref 提到全局。 */
  searchFocus: number
  /** 顶栏搜索框提交的关键词，搜索面板消费一次后清空。 */
  heroQuery: string | null
  /** 搜索面板是否展开。搜索是顶栏的一个面板，不是独立页面。 */
  searchOpen: boolean
  /** 搜索面板当前实际搜索的词。顶栏输入框跟着它走，两边不会各说各话。 */
  currentQuery: string
  /** 搜索面板上次用的分区与排序，收起再打开要恢复。 */
  currentPartition: string
  currentOrder: string
  /** 时长筛选：0 不限，1~4 对应 B 站的 duration 参数。 */
  currentDuration: number
  messageUnread: MessageUnread | null
  setMessageUnread: (unread: MessageUnread | null) => void
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
  toasts: Toast[]
  /** 当前视图之前去过哪里。返回按钮用它，不再写死跳某一页。 */
  history: View[]
  /** 左栏是完整标签版还是只剩图标的窄条。 */
  sidebar: SidebarMode
  toggleSidebar: () => void
  navigate: (view: View) => void
  /** 换一条视频但不进历史：观看页里点相关推荐或自动连播，返回该回到来的那一页。 */
  replace: (view: View) => void
  /** 回上一层；没有历史就回发现页。 */
  goBack: () => void
  setRail: (tab: RailTab | null) => void
  toggleRail: (tab: RailTab) => void
  closeRail: () => void
  focusSearch: () => void
  setHeroQuery: (q: string | null) => void
  closeSearch: () => void
  setCurrentQuery: (q: string) => void
  setSearchFilters: (partition: string, order: string, duration?: number) => void
  setAuthOpen: (open: boolean) => void
  setStage: (open: boolean) => void
  setCinema: (on: boolean) => void
  setOsFullscreen: (on: boolean) => void
  pushToast: (tone: ToastTone, title: string, detail: string | null) => void
  dismissToast: (id: number) => void
}

export const useAppStore = create<AppStore>()((set, get) => ({
  view: { kind: 'home' },
  history: [],
  sidebar: loadSidebar(),
  toggleSidebar: () => {
    const next: SidebarMode = get().sidebar === 'full' ? 'rail' : 'full'
    saveSidebar(next)
    captureCards()
    set({ sidebar: next })
  },
  // 默认收起：没在播放时右栏没有内容，让它占宽度就是把中间白白挤窄。
  rail: null,
  searchFocus: 0,
  heroQuery: null,
  searchOpen: false,
  currentQuery: '',
  currentPartition: '全部',
  currentOrder: 'totalrank',
  currentDuration: 0,
  messageUnread: null,
  setMessageUnread: (messageUnread) => set({ messageUnread }),
  authOpen: false,
  mv: null,
  stage: false,
  cinema: false,
  osFullscreen: false,
  toasts: [],
  navigate: (view) =>
    set((state) => {
      // 同一个视图重复点不算一次前进，否则「返回」要按很多次才动。
      if (state.view.kind === view.kind && JSON.stringify(state.view) === JSON.stringify(view)) {
        return { searchOpen: false }
      }
      return {
        view,
        searchOpen: false,
        cinema: false,
        osFullscreen: false,
        history: [...state.history, state.view].slice(-32),
      }
    }),
  replace: (view) => set({ view, searchOpen: false, cinema: false, osFullscreen: false }),
  goBack: () =>
    set((state) => {
      const prev = state.history.at(-1)
      if (!prev) {
        return { view: { kind: 'home' } as View, searchOpen: false, cinema: false, osFullscreen: false }
      }
      return {
        view: prev,
        searchOpen: false,
        cinema: false,
        osFullscreen: false,
        history: state.history.slice(0, -1),
      }
    }),
  setRail: (tab) => set({ rail: tab }),
  toggleRail: (tab) => set({ rail: get().rail === tab ? null : tab }),
  closeRail: () => set({ rail: null }),
  focusSearch: () => set((state) => ({ searchFocus: state.searchFocus + 1 })),
  // null 只表示「这一条请求已被面板消费」，不该把面板重新打开。
  setHeroQuery: (q) =>
    q === null ? set({ heroQuery: null }) : set({ heroQuery: q, currentQuery: q, searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),
  setCurrentQuery: (q) => set({ currentQuery: q }),
  setSearchFilters: (partition, order, duration = 0) =>
    set({ currentPartition: partition, currentOrder: order, currentDuration: duration }),
  setAuthOpen: (open) => set({ authOpen: open }),
  setStage: (open) => set({ stage: open }),
  setCinema: (on) => set({ cinema: on }),
  setOsFullscreen: (on) => set({ osFullscreen: on }),
  pushToast: (tone, title, detail) => {
    toastSeq += 1
    const toast: Toast = { id: toastSeq, tone, title, detail }
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }))
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
