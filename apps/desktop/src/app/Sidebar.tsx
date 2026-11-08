import { useState } from 'react'
import type { View } from './appStore'
import { useAppStore } from './appStore'
import { useAuthStore } from '../features/auth/authStore'
import { useDownloadsStore } from '../features/downloads/downloadsStore'
import { useLibraryStore } from '../features/library/libraryStore'
import { useReactionStore } from '../features/reactions/reactionStore'
import { CreatePlaylistModal } from '../features/library/CreatePlaylistModal'
import { Icon } from '../shared/ui/Icon'
import type { IconName } from '../shared/ui/Icon'
import { Skeleton } from '../shared/ui/Skeleton'

type NavItem = { view: View; label: string; icon: IconName }

const NAV: readonly NavItem[] = [
  { view: { kind: 'search' }, label: '搜索', icon: 'search' },
  { view: { kind: 'library' }, label: '曲库', icon: 'library' },
  { view: { kind: 'liked' }, label: '喜欢', icon: 'heart' },
  { view: { kind: 'downloads' }, label: '下载', icon: 'download' },
  { view: { kind: 'settings' }, label: '设置', icon: 'settings' },
]

export function Sidebar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const playlists = useLibraryStore((state) => state.playlists)
  const auth = useAuthStore((state) => state.auth)
  const likedCount = useReactionStore((state) => state.likedTracks.length)
  const downloads = useDownloadsStore((state) => state.items)
  const [creating, setCreating] = useState(false)

  const runningDownloads = (downloads ?? []).filter((item) => item.state === 'running' || item.state === 'queued').length
  const user = auth?.logged_in === true ? auth.user : null

  return (
    <aside className="glass flex w-[232px] shrink-0 flex-col overflow-hidden rounded-[26px] border border-hairline">
      <nav className="flex flex-col gap-1 px-3 pt-4">
        {NAV.map((item) => {
          const active = view.kind === item.view.kind
          const badge = item.view.kind === 'liked' ? likedCount : item.view.kind === 'downloads' ? runningDownloads : 0
          return (
            <button
              key={item.view.kind}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.view)}
              className={[
                'group t press flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px]',
                active
                  ? 'bg-white/14 text-white'
                  : 'text-white/62 hover:bg-white/[0.06] hover:text-white/88',
              ].join(' ')}
            >
              <span className={active ? 'text-[var(--accent)]' : 'text-white/50 group-hover:text-white/75'}>
                <Icon name={item.icon} />
              </span>
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 ? (
                <span className="rounded-full bg-white/10 px-1.5 py-[1px] font-mono text-[10px] text-white/55">{badge}</span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="mt-6 flex items-center justify-between px-5">
        <span className="text-[10px] uppercase tracking-[0.22em] text-white/32">歌单</span>
        <button
          type="button"
          aria-label="新建歌单"
          title="新建歌单"
          onClick={() => setCreating(true)}
          className="t press rounded-full p-1 text-white/34 hover:bg-white/10 hover:text-white/80"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {playlists === null ? (
          <div className="space-y-2 px-3 py-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
        ) : playlists.length === 0 ? (
          <p className="px-3 py-2 text-[11.5px] leading-relaxed text-white/32">还没有歌单，点上面的加号建一个。</p>
        ) : (
          playlists.map((playlist) => {
            const active = view.kind === 'playlist' && view.id === playlist.id
            return (
              <button
                key={playlist.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                title={playlist.name}
                onClick={() => navigate({ kind: 'playlist', id: playlist.id, name: playlist.name })}
                className={[
                  't press truncate rounded-lg px-3 py-2 text-left text-[12.5px]',
                  active ? 'bg-white/10 text-white/92' : 'text-white/48 hover:bg-white/[0.05] hover:text-white/82',
                ].join(' ')}
              >
                {playlist.name}
              </button>
            )
          })
        )}
      </div>

      <div className="border-t border-hairline p-3">
        <button
          type="button"
          onClick={() => (user ? navigate({ kind: 'settings' }) : setAuthOpen(true))}
          className="t press flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.06]"
        >
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="h-9 w-9 rounded-full border border-white/12 object-cover" />
          ) : user ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#ff3d81] to-[#7c4dff] text-[13px] font-medium text-white/90">
              {user.uname.slice(0, 1)}
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/40">
              <Icon name="user" size={16} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-white/82">{user ? user.uname : '未登录'}</span>
            <span className="mt-1 block truncate text-[10.5px] text-white/32">
              {user ? `UID ${user.mid}` : '扫码登录后同步喜欢'}
            </span>
          </span>
        </button>
      </div>

      <CreatePlaylistModal open={creating} onClose={() => setCreating(false)} />
    </aside>
  )
}
