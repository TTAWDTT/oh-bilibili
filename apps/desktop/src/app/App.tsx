import { useEffect, useLayoutEffect, useRef } from 'react'
import { AuthModal } from '../features/auth/AuthModal'
import { DownloadsView } from '../features/downloads/DownloadsView'
import { AuthorView } from '../features/library/AuthorView'
import { FavFoldersView } from '../features/library/FavFoldersView'
import { HistoryView } from '../features/library/HistoryView'
import { LibraryView } from '../features/library/LibraryView'
import { LikedView } from '../features/library/LikedView'
import { PlaylistView } from '../features/library/PlaylistView'
import { NowPlayingRail } from '../features/player/NowPlayingRail'
import { StageView } from '../features/player/StageView'
import { PlayerBar } from '../features/player/PlayerBar'
import { useHasSession, useIsListening, usePlayerStore } from '../features/player/playerStore'
import { SearchPanel } from '../features/search/SearchPanel'
import { SettingsView } from '../features/settings/SettingsView'
import { ProfileView } from '../features/profile/ProfileView'
import { ToastHost } from '../shared/ui/ToastHost'
import type { View } from './appStore'
import { glideCards, useAppStore } from './appStore'
import { Sidebar } from './Sidebar'
import { MobileTabBar } from './MobileTabBar'
import { MobileRailSheet } from './MobileRailSheet'
import { DanmakuStrip } from './DanmakuStrip'
import { BackToTop } from '../shared/ui/BackToTop'
import { TitleBar } from './TitleBar'
import { useBootstrap } from './useBootstrap'
import { useShortcuts } from './useShortcuts'
import { WatchView } from '../features/watch/WatchView'
import { HomeView } from '../features/home/HomeView'
import { RankingView } from '../features/home/RankingView'
import { PopularView } from '../features/home/PopularView'
import { PreciousView } from '../features/home/PreciousView'
import { WeeklyView } from '../features/home/WeeklyView'
import { LiveView } from '../features/home/LiveView'
import { BangumiView } from '../features/home/BangumiView'
import { WatchLaterView } from '../features/library/WatchLaterView'
import { FollowingView } from '../features/library/FollowingView'
import { DynamicView } from '../features/home/DynamicView'
import { MessagesView } from '../features/messages/MessagesView'

/**
 * 当前页面的标题。
 *
 * 视觉上不显示（页面顶部的文字按设计要求尽量少），但屏幕阅读器需要它：
 * 没有 h1 的页面在标题导航里是空的，用户不知道自己在哪。
 */
function viewTitle(view: View): string {
  switch (view.kind) {
    case 'home':
      return '发现'
    case 'dynamic':
      return '动态'
    case 'messages':
      return '消息中心'
    case 'ranking':
      return '排行榜'
    case 'popular':
      return '综合热门'
    case 'precious':
      return '入站必刷'
    case 'weekly':
      return '每周必看'
    case 'live':
      return '直播'
    case 'bangumi':
      return '番剧'
    case 'library':
      return '曲库'
    case 'playlist':
      return `播放列表：${view.name}`
    case 'liked':
      return '赞过的视频'
    case 'downloads':
      return '已下载'
    case 'history':
      return '播放历史'
    case 'favs':
      return '收藏夹'
    case 'author':
      return `UP 主：${view.name}`
    case 'settings':
      return '设置'
    case 'profile':
      return '我的'
    case 'watch':
      return `观看：${view.track.title}`
    case 'watchLater':
      return '稍后再看'
    case 'following':
      return '我关注的人'
  }
}

function CurrentView({ view }: { view: View }) {
  switch (view.kind) {
    case 'home':
      return <HomeView />
    case 'dynamic':
      return <DynamicView />
    case 'messages':
      return <MessagesView />
    case 'ranking':
      return <RankingView initialRid={view.rid ?? 0} />
    case 'popular':
      return <PopularView />
    case 'precious':
      return <PreciousView />
    case 'weekly':
      return <WeeklyView />
    case 'live':
      return <LiveView />
    case 'bangumi':
      return <BangumiView />
    case 'library':
      return <LibraryView />
    case 'playlist':
      return <PlaylistView id={view.id} name={view.name} />
    case 'liked':
      return <LikedView />
    case 'downloads':
      return <DownloadsView />
    case 'history':
      return <HistoryView />
    case 'favs':
      return <FavFoldersView />
    case 'author':
      return <AuthorView name={view.name} mid={view.mid ?? null} />
    case 'settings':
      return <SettingsView />
    case 'profile':
      return <ProfileView />
    case 'watch':
      return (
        <WatchView
          key={`${view.track.key}:${view.page ?? ''}:${view.atMs ?? ''}`}
          track={view.track}
          {...(view.page !== undefined ? { page: view.page } : {})}
          {...(view.atMs !== undefined ? { atMs: view.atMs } : {})}
        />
      )
    case 'watchLater':
      return <WatchLaterView />
    case 'following':
      return <FollowingView />
  }
}

/**
 * 侧栏切换后把可见卡片从旧位置滑到新位置。
 *
 * 单独做成组件：App 本身不能订阅 sidebar，否则每次开合都会把整棵页面
 * 子树重渲染一遍，比网格重排还贵。
 */
function SidebarGlide() {
  const sidebar = useAppStore((state) => state.sidebar)
  useLayoutEffect(() => {
    glideCards()
  }, [sidebar])
  return null
}

/**
 * 返回时把焦点还给进来的那一项。
 *
 * 入口散在网格、轮播、排行、歌单行里，统一在入口元素上标 `data-focus-key`，
 * 由这里按记录恢复；搜索面板开着时交给它自己处理。
 */
function FocusRestore() {
  const view = useAppStore((state) => state.view)
  useEffect(() => {
    const focus = useAppStore.getState().returnFocus
    if (!focus) return
    // 历史页自己按行恢复焦点（空态、删除相邻行都归它管），这里不插手。
    if (focus.kind === 'history') return
    let stopped = false
    let tries = 0
    let timer: number | null = null
    const fixes: number[] = []
    /** 用户一动就停：返回后的自动校正不能跟人抢滚动。 */
    const stopFixes = (): void => {
      for (const id of fixes) window.clearTimeout(id)
      fixes.length = 0
    }
    const onUserAction = (): void => {
      stopFixes()
    }
    window.addEventListener('wheel', onUserAction, { passive: true })
    window.addEventListener('pointerdown', onUserAction, true)
    window.addEventListener('keydown', onUserAction, true)
    window.addEventListener('touchstart', onUserAction, { passive: true })
    const visible = (element: HTMLElement): boolean =>
      element.isConnected && element.getClientRects().length > 0
    const find = (): HTMLElement | null =>
      [...document.querySelectorAll<HTMLElement>(`[data-focus-id="${focus.id}"]`)].find(visible) ?? null
    /** 列表可能在聚焦后才完成布局：滚到能看见，不改变页面其他位置。 */
    const ensureVisible = (target: HTMLElement): void => {
      const box = target.closest<HTMLElement>('#scroll-main')
      if (!box) return
      const rect = target.getBoundingClientRect()
      const area = box.getBoundingClientRect()
      if (rect.top < area.top || rect.bottom > area.bottom) {
        target.scrollIntoView({ block: 'nearest' })
      }
    }
    let candidate: HTMLElement | null = null
    let since = 0
    const run = (): void => {
      if (stopped) return
      const app = useAppStore.getState()
      if (app.searchOpen || app.view.kind !== focus.kind) return
      const target = find()
      if (!target) {
        // 目标一直不出现（窗口化未渲染、入口已不在）就放弃，不要永远轮询。
        if (tries >= 30) {
          app.clearReturnFocus()
          return
        }
        tries += 1
        timer = window.setTimeout(run, 100)
        return
      }
      // 同一个目标稳定出现 150ms 才算数：续播卡加载完会把同一曲目从推荐流里换走。
      if (target !== candidate) {
        candidate = target
        since = Date.now()
        timer = window.setTimeout(run, 100)
        return
      }
      if (Date.now() - since < 150) {
        timer = window.setTimeout(run, 100)
        return
      }
      app.clearReturnFocus()
      target.focus({ preventScroll: true })
      ensureVisible(target)
      fixes.push(window.setTimeout(() => ensureVisible(target), 250))
      fixes.push(window.setTimeout(() => ensureVisible(target), 700))
    }
    run()
    return () => {
      stopped = true
      if (timer !== null) window.clearTimeout(timer)
      stopFixes()
      window.removeEventListener('wheel', onUserAction)
      window.removeEventListener('pointerdown', onUserAction, true)
      window.removeEventListener('keydown', onUserAction, true)
      window.removeEventListener('touchstart', onUserAction)
    }
  }, [view])
  return null
}

export default function App() {
  useBootstrap()
  useShortcuts()
  const view = useAppStore((state) => state.view)
  const rail = useAppStore((state) => state.rail)
  const setRail = useAppStore((state) => state.setRail)
  // 只有进系统全屏才藏标题栏。网页全屏要留着它：自定义标题栏里带着
  // 关闭与最小化按钮，藏掉窗口就没法关了。
  const osFullscreen = useAppStore((state) => state.osFullscreen)
  const cinema = useAppStore((state) => state.cinema)
  const searchOpen = useAppStore((state) => state.searchOpen)
  const track = usePlayerStore((state) => state.snapshot?.track ?? null)
  const queued = usePlayerStore((state) => state.queue?.items.length ?? 0)

  // 右栏是「听」才需要的东西（歌词与队列）。
  // 判据不能只是「有曲目或队列」：队列会在启动时恢复，于是刷视频、看视频时
  // 右侧一直挂着一栏歌词，像在放一首根本不存在的歌。
  const listening = useIsListening()
  const hasSession = useHasSession()
  const hasContent = listening && hasSession && (track !== null || queued > 0)
  const railOpen = hasContent && rail !== null
  const trackKey = track?.key ?? null
  // 观看页也保留左栏：要跳去别的主页面时从同一侧展开，不必先退出去。
  // 想给视频多留宽度就把它收成窄栏，偏好沿用到下一次。
  const showSidebar = !(view.kind === 'watch' && (cinema || osFullscreen))
  // 右栏与全屏弹幕都只属于「听」的页面：它说的是一条正在播放的音轨，
  // 挂在发现、排行、历史这些页面上既不相关，也会白白吃掉正文宽度。
  const musicView = ['library', 'playlist', 'liked', 'downloads'].includes(view.kind)

  useEffect(() => {
    if (!trackKey || !musicView) return
    // 窄屏的右栏是一整张全屏面板，跟着每首歌自动弹出来会盖住正在看的页面；
    // 宽屏才把歌词栏拉回来，窄屏留给迷你播放条上的歌词/队列按钮。
    if (!window.matchMedia('(min-width: 1280px)').matches) return
    if (useAppStore.getState().rail === null) setRail('lyrics')
  }, [trackKey, musicView, setRail])

  // 离开「听」的页面时收起右栏；手动打开仍然有效，只是不会被自动带过去。
  const previousKind = useRef(view.kind)
  useEffect(() => {
    if (previousKind.current === view.kind) return
    previousKind.current = view.kind
    if (!musicView) setRail(null)
  }, [view.kind, musicView, setRail])

  // 从宽窗口拖到窄窗口时，桌面的右栏会变成盖住整页的面板；跨过断点就收起，
  // 需要时再点播放条上的歌词/队列按钮打开。
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1279px)')
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) setRail(null)
    }
    narrow.addEventListener('change', onChange)
    return () => narrow.removeEventListener('change', onChange)
  }, [setRail])

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-[var(--text-1)]"
      style={{ background: 'var(--color-ink)' }}>
      <SidebarGlide />
      <FocusRestore />
      {/* 键盘用户跳过导航直达内容；不聚焦时不可见 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-[4px] focus:bg-[var(--accent)] focus:px-3 focus:py-1.5 focus:text-[13px] focus:text-white"
      >
        跳到主要内容
      </a>
      {osFullscreen ? null : <TitleBar />}

      <div className="relative z-10 flex min-h-0 flex-1">
        {showSidebar ? <Sidebar /> : null}
        {/*
         * 页面区域自己铺底：观看页不挂侧栏，主区会从 0 起画。
         * WebKit 会把卸掉侧栏的那块合成层留到下一次重绘，透明背景下
         * 就成了一条点不动的「幽灵侧栏」，直到窗口 resize 才消失。
         */}
        <main
          id="main-content"
          tabIndex={-1}
          className="block min-w-0 flex-1 overflow-hidden bg-[var(--color-ink)] outline-none"
        >
          {/* 必须是 flex 列：多数视图根节点用 min-h-0 flex-1 overflow-y-auto，
                父级不是 flex 时 flex-1 不生效、高度变成 auto，页面就滚不动了。 */}
          <div key={view.kind} className="bili-page flex h-full flex-col">
            <h1 className="sr-only">{viewTitle(view)}</h1>
            <CurrentView view={view} />
          </div>
        </main>
        <div className="rail-slot hidden xl:block" data-open={railOpen} inert={!railOpen} aria-hidden={!railOpen}>
          <NowPlayingRail tab={rail ?? 'lyrics'} />
        </div>
        {musicView && listening ? <DanmakuStrip /> : null}
      </div>

      {/* 搜索是顶栏下拉出来的面板：盖住整页，但顶栏的输入框始终可编辑。 */}
      {searchOpen ? <SearchPanel /> : null}
      {searchOpen ? null : <BackToTop targetId="scroll-main" />}
      <PlayerBar />
      {/* 影院与系统全屏是沉浸态：底部主导航收起，退出后回到原标签。 */}
      {view.kind === 'watch' && (cinema || osFullscreen) ? null : <MobileTabBar />}
      {railOpen ? <MobileRailSheet tab={rail ?? 'lyrics'} /> : null}
      <StageView />
      <ToastHost />
      <AuthModal />
    </div>
  )
}
