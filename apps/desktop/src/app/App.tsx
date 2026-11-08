import { AuthModal } from '../features/auth/AuthModal'
import { DownloadsView } from '../features/downloads/DownloadsView'
import { LibraryView } from '../features/library/LibraryView'
import { LikedView } from '../features/library/LikedView'
import { PlaylistView } from '../features/library/PlaylistView'
import { NowPlayingRail } from '../features/player/NowPlayingRail'
import { PlayerBar } from '../features/player/PlayerBar'
import { usePlayerStore } from '../features/player/playerStore'
import { SearchView } from '../features/search/SearchView'
import { SettingsView } from '../features/settings/SettingsView'
import { useAccentVars, useTrackAccent } from '../shared/lib/accent'
import { ToastHost } from '../shared/ui/ToastHost'
import { Aurora } from './Aurora'
import type { View } from './appStore'
import { useAppStore } from './appStore'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { useBootstrap } from './useBootstrap'

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
    case 'settings':
      return <SettingsView />
  }
}

export default function App() {
  useBootstrap()
  const view = useAppStore((state) => state.view)
  const rail = useAppStore((state) => state.rail)
  const track = usePlayerStore((state) => state.snapshot?.track ?? null)
  const accent = useTrackAccent(track)
  useAccentVars(accent)

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-ink text-white">
      <Aurora accent={accent} />
      <div className="grain pointer-events-none absolute inset-0 z-[1]" />
      <TitleBar />

      <div className="relative z-10 flex min-h-0 flex-1 gap-3 px-3">
        <Sidebar />
        <main className="glass flex min-w-0 flex-1 overflow-hidden rounded-[26px] border border-hairline">
          <CurrentView view={view} />
        </main>
        {rail ? <NowPlayingRail tab={rail} /> : null}
      </div>

      <PlayerBar />
      <ToastHost />
      <AuthModal />
    </div>
  )
}
