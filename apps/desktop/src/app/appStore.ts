import type { Track } from '../shared/lib/contract'
import type { MessageUnread } from '../shared/lib/ipc'
import { create } from 'zustand'

export type View =
  | { kind: 'home'; rid?: number }
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
  /** `page`/`atMs` 用于从弹幕引文直接落到那一分 P 的那一刻。 */
  | { kind: 'watch'; track: Track; page?: number; atMs?: number }
  | { kind: 'watchLater' }
  | { kind: 'following' }
  /** 搜索结果作为一页放进正文；顶栏输入框仍是唯一的入口。 */
  | { kind: 'search'; query: string }
  | { kind: 'profile' }
  | { kind: 'settings' }

export type DynamicTab = 'all' | 'video' | 'opus'
export type DynamicReturn = {
  tab: DynamicTab
  /** 当时选中的作者；返回时要还原同一个筛选。 */
  author: number | null
  itemIds: string[]
  index: number
  expandedBodies: string[]
  top: number
  trigger: string
  allTop: number
  restoreFocus: boolean
  pages: number
}

/** 返回时把焦点还给进入下一页的那张卡；没有入口卡片时为空。 */
type HistoryEntry = { view: View; dynamicReturn: DynamicReturn | undefined; focusId: string | null }

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
  history: HistoryEntry[]
  dynamicReturn: DynamicReturn | undefined
  /** 左栏是完整标签版还是只剩图标的窄条。 */
  sidebar: SidebarMode
  toggleSidebar: () => void
  /** 观看页默认只留窄栏给视频让宽度；展开/收起不覆盖浏览页的偏好。 */
  watchNav: SidebarMode
  toggleWatchNav: () => void
  navigate: (view: View, dynamicReturn?: DynamicReturn, fromFocus?: string) => void
  /** 返回后要接住焦点的卡片：只让对应页面的那一个列表消费。 */
  returnFocus: { kind: View['kind']; id: string } | null
  clearReturnFocus: () => void
  /** 从哪一类页面进的观看页，左栏据此保留来源高亮。 */
  watchSource: View['kind'] | null
  /** 换一条视频但不进历史：观看页里点相关推荐或自动连播，返回该回到来的那一页。 */
  replace: (view: View) => void
  /** 回上一层；没有历史就回发现页。 */
  goBack: () => void
  setRail: (tab: RailTab | null) => void
  toggleRail: (tab: RailTab) => void
  closeRail: () => void
  focusSearch: () => void
  setHeroQuery: (q: string) => void
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
  dynamicReturn: undefined,
  returnFocus: null,
  clearReturnFocus: () => set({ returnFocus: null }),
  watchSource: null,
  sidebar: loadSidebar(),
  watchNav: 'rail',
  toggleWatchNav: () => set({ watchNav: get().watchNav === 'rail' ? 'full' : 'rail' }),
  toggleSidebar: () => {
    const next: SidebarMode = get().sidebar === 'full' ? 'rail' : 'full'
    saveSidebar(next)
    captureCards()
    set({ sidebar: next })
  },
  // 默认收起：没在播放时右栏没有内容，让它占宽度就是把中间白白挤窄。
  rail: null,
  searchFocus: 0,
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
  navigate: (view, dynamicReturn, fromFocus) =>
    set((state) => {
      // 同一个视图重复点不算一次前进，否则「返回」要按很多次才动。
      if (state.view.kind === view.kind && JSON.stringify(state.view) === JSON.stringify(view)) {
        return state
      }
      return {
        view,
        returnFocus: null,
        watchSource: view.kind === 'watch' ? state.view.kind : null,
        cinema: false,
        osFullscreen: false,
        history: [
          ...state.history,
          { view: state.view, dynamicReturn, focusId: fromFocus ?? null },
        ].slice(-32),
        dynamicReturn: undefined,
      }
    }),
  replace: (view) =>
    set({
      view,
      returnFocus: null,
      dynamicReturn: undefined,
      cinema: false,
      osFullscreen: false,
    }),
  goBack: () =>
    set((state) => {
      const prev = state.history.at(-1)
      if (!prev) {
        return {
          dynamicReturn: undefined,
          view: { kind: 'home' } as View,
          cinema: false,
          osFullscreen: false,
        }
      }
      return {
        view: prev.view,
        currentQuery: prev.view.kind === 'search' ? prev.view.query : state.currentQuery,
        dynamicReturn: prev.dynamicReturn,
        returnFocus:
          prev.focusId
            ? { kind: prev.view.kind, id: prev.focusId }
            : null,
        cinema: false,
        osFullscreen: false,
        history: state.history.slice(0, -1),
      }
    }),
  setRail: (tab) => set({ rail: tab }),
  toggleRail: (tab) => set({ rail: get().rail === tab ? null : tab }),
  closeRail: () => set({ rail: null }),
  focusSearch: () => set((state) => ({ searchFocus: state.searchFocus + 1 })),
  setHeroQuery: (q) => {
    set({ currentQuery: q })
    const view = { kind: 'search', query: q } as const
    if (get().view.kind === 'search') get().replace(view)
    else get().navigate(view)
  },
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
