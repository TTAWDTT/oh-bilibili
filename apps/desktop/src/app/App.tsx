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
import { MvOverlay } from '../features/player/MvOverlay'
import { StageView } from '../features/player/StageView'
import { PlayerBar } from '../features/player/PlayerBar'
import { usePlayerStore } from '../features/player/playerStore'
import { SearchView } from '../features/search/SearchView'
import { SettingsView } from '../features/settings/SettingsView'
import { ToastHost } from '../shared/ui/ToastHost'
import type { View } from './appStore'
import { useAppStore } from './appStore'
import { ChannelBar } from './ChannelBar'
import { DanmakuStrip } from './DanmakuStrip'
import { BackToTop } from '../shared/ui/BackToTop'
import { Sidebar } from './Sidebar'
import { StageGlow } from './StageGlow'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { useBootstrap } from './useBootstrap'
import { useShortcuts } from './useShortcuts'

function CurrentView({ view }: { view: View }) {
  switch (view.kind) {
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
  }
}

export default function App() {
  useBootstrap()
  useShortcuts()
  const view = useAppStore((state) => state.view)
  const rail = useAppStore((state) => state.rail)
  const setRail = useAppStore((state) => state.setRail)
  const track = usePlayerStore((state) => state.snapshot?.track ?? null)
  const queued = usePlayerStore((state) => state.queue?.items.length ?? 0)

  // 没歌也没队列时右栏没有任何内容可看，收起它让中间真正铺满。
  const hasContent = track !== null || queued > 0
  const railOpen = hasContent && rail !== null
  const trackKey = track?.key ?? null

  useEffect(() => {
    if (!trackKey) return
    // 新歌开播才把右栏拉回来；用户手动收起后不再固执地弹回。
    if (useAppStore.getState().rail === null) setRail('lyrics')
  }, [trackKey, setRail])

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
      <StageGlow />
      <TitleBar />
      <ChannelBar />
      <DanmakuStrip />

      <div className="relative z-10 flex min-h-0 flex-1">
        <Sidebar />
        <main id="main-content" tabIndex={-1} className="block min-w-0 flex-1 overflow-hidden outline-none">
          <div key={view.kind} className="bili-page h-full">
            <CurrentView view={view} />
          </div>
        </main>
        <div className="rail-slot" data-open={railOpen} inert={!railOpen} aria-hidden={!railOpen}>
          <NowPlayingRail tab={rail ?? 'lyrics'} />
        </div>
      </div>

      <BackToTop targetId="scroll-main" />
      <PlayerBar />
      <StatusBar />
      <MvOverlay />
      <StageView />
      <ToastHost />
      <AuthModal />
    </div>
  )
}
