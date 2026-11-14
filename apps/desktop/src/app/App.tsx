import { useEffect } from 'react'
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
import { SearchView } from '../features/search/SearchView'
import { SettingsView } from '../features/settings/SettingsView'
import { ToastHost } from '../shared/ui/ToastHost'
import type { View } from './appStore'
import { useAppStore } from './appStore'
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
import { WatchLaterView } from '../features/library/WatchLaterView'
import { FollowingView } from '../features/library/FollowingView'

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
    case 'ranking':
      return '排行榜'
    case 'popular':
      return '热门'
    case 'precious':
      return '入站必刷'
    case 'weekly':
      return '每周必看'
    case 'search':
      return '搜索'
    case 'library':
      return '曲库'
    case 'playlist':
      return `播放列表：${view.name}`
    case 'liked':
      return '我喜欢的音乐'
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
    case 'ranking':
      return <RankingView initialRid={view.rid ?? 0} />
    case 'popular':
      return <PopularView />
    case 'precious':
      return <PreciousView />
    case 'weekly':
      return <WeeklyView />
    case 'search':
      return <SearchView />
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
    case 'watch':
      return <WatchView key={view.track.key} track={view.track} />
    case 'watchLater':
      return <WatchLaterView />
    case 'following':
      return <FollowingView />
  }
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
  // 观看页不要导航：播放器要的是宽度，而且这一页里导航没有去处。
  // 返回靠信息区标题旁的返回键，不是靠侧栏。
  const showSidebar = view.kind !== 'watch'
  // 全屏弹幕只在「正在听」的音乐页出现。它说的是一条正在播放的音轨，
  // 盖在发现页的封面上就是噪声；观看页有自己的弹幕层，再叠一层会双倍。
  const musicView = ['library', 'playlist', 'liked', 'downloads'].includes(view.kind)

  useEffect(() => {
    if (!trackKey) return
    // 窄屏的右栏是一整张全屏面板，跟着每首歌自动弹出来会盖住正在看的页面；
    // 宽屏才把歌词栏拉回来，窄屏留给迷你播放条上的歌词/队列按钮。
    if (!window.matchMedia('(min-width: 768px)').matches) return
    if (useAppStore.getState().rail === null) setRail('lyrics')
  }, [trackKey, setRail])

  // 从宽窗口拖到窄窗口时，桌面的右栏会变成盖住整页的面板；跨过断点就收起，
  // 需要时再点播放条上的歌词/队列按钮打开。
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 767px)')
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) setRail(null)
    }
    narrow.addEventListener('change', onChange)
    return () => narrow.removeEventListener('change', onChange)
  }, [setRail])

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-[var(--text-1)]"
      style={{ background: 'var(--color-ink)' }}>
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
        <main id="main-content" tabIndex={-1} className="block min-w-0 flex-1 overflow-hidden outline-none">
          {/* 必须是 flex 列：多数视图根节点用 min-h-0 flex-1 overflow-y-auto，
                父级不是 flex 时 flex-1 不生效、高度变成 auto，页面就滚不动了。 */}
          <div key={view.kind} className="bili-page flex h-full flex-col">
            <h1 className="sr-only">{viewTitle(view)}</h1>
            <CurrentView view={view} />
          </div>
        </main>
        <div className="rail-slot hidden md:block" data-open={railOpen} inert={!railOpen} aria-hidden={!railOpen}>
          <NowPlayingRail tab={rail ?? 'lyrics'} />
        </div>
        {musicView && listening ? <DanmakuStrip /> : null}
      </div>

      <BackToTop targetId="scroll-main" />
      <PlayerBar />
      <MobileTabBar />
      {railOpen ? <MobileRailSheet tab={rail ?? 'lyrics'} /> : null}
      <StageView />
      <ToastHost />
      <AuthModal />
    </div>
  )
}
