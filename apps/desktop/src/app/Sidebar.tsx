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

/** 左栏与主区共用同一条发丝线：激活项靠左侧 2px 色条标记，不再铺底色。 */
const ROW = 't group flex items-center border-l-2 text-left'

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
    <aside className="flex w-[224px] shrink-0 flex-col overflow-hidden border-r border-hairline bg-[var(--panel)]">
      <nav className="flex flex-col pt-1">
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
                ROW,
                'gap-2 px-4 py-1.5 text-[12.5px]',
                active ? 'border-[var(--accent)] text-white' : 'border-transparent text-white/62 hover:text-white',
              ].join(' ')}
            >
              <span className={active ? 'text-[var(--accent)]' : 'text-white/40 group-hover:text-white/80'}>
                <Icon name={item.icon} />
              </span>
              <span className="flex-1">{item.label}</span>
              {badge > 0 ? (
                <span className="rounded-full bg-white/10 px-1.5 py-[1px] font-mono text-[10px] text-white/55">{badge}</span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="mt-4 flex items-center justify-between border-t border-hairline pl-4 pr-3 pb-1 pt-3">
        <span className="text-[10px] uppercase tracking-[0.22em] text-white/32">歌单</span>
        <button
          type="button"
          aria-label="新建歌单"
          title="新建歌单"
          onClick={() => setCreating(true)}
          className="t press rounded-[4px] p-1 text-white/34 hover:text-white"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        {playlists === null ? (
          <div className="space-y-2.5 px-4 py-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : playlists.length === 0 ? (
          <p className="px-4 py-2 text-[11.5px] leading-relaxed text-white/32">还没有歌单，点上面的加号建一个。</p>
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
                  ROW,
                  'truncate px-4 py-1.5 text-[12.5px]',
                  active ? 'border-[var(--accent)] text-white' : 'border-transparent text-white/48 hover:text-white',
                ].join(' ')}
              >
                <span className="truncate">{playlist.name}</span>
              </button>
            )
          })
        )}
      </div>

      <div className="border-t border-hairline p-3">
        <button
          type="button"
          onClick={() => (user ? navigate({ kind: 'settings' }) : setAuthOpen(true))}
          className="t flex w-full items-center gap-2 px-1 py-2 text-left"
        >
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="h-9 w-9 rounded-[4px] border border-white/12 object-cover" />
          ) : user ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-white/10 text-[12.5px] font-medium text-white/90">
              {user.uname.slice(0, 1)}
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-white/12 text-white/40">
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
