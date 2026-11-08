import { useState } from 'react'
import type { View } from './appStore'
import { useAppStore } from './appStore'
import { useAuthStore } from '../features/auth/authStore'
import { useLibraryStore } from '../features/library/libraryStore'
import { CreatePlaylistModal } from '../features/library/CreatePlaylistModal'
import { Icon } from '../shared/ui/Icon'
import { Skeleton } from '../shared/ui/Skeleton'

/** 侧栏行：24px 高，hover 是深灰填充而不是只改文字色——这是编辑器式列表的通用手感。 */
const ROW =
  't mx-1 flex h-6 items-center gap-2 rounded-[3px] px-2 text-left text-[12px]'
const ROW_IDLE = 'text-[var(--text-2)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]'
const ROW_ACTIVE = 'bg-[var(--hover)] text-[var(--text-1)]'
const SECTION = 'px-3 pb-1 pt-3 text-[11px] font-medium tracking-[0.08em] text-[var(--text-3)]'

export function Sidebar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const playlists = useLibraryStore((state) => state.playlists)
  const auth = useAuthStore((state) => state.auth)
  const [creating, setCreating] = useState(false)

  const user = auth?.logged_in === true ? auth.user : null

  return (
    <aside className="flex w-[224px] shrink-0 flex-col overflow-hidden border-r border-hairline bg-[var(--panel-alt)]">
      <div className="flex items-center justify-between pr-2">
        <span className={SECTION}>歌单</span>
        <button
          type="button"
          aria-label="新建歌单"
          title="新建歌单"
          onClick={() => setCreating(true)}
          className="t -mt-1 rounded-[3px] h-6 w-6 text-[var(--text-3)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]"
        >
          <Icon name="plus" size={13} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
        {playlists === null ? (
          <div className="space-y-2 px-3 py-1">
            <Skeleton className="h-2.5 w-3/4" />
            <Skeleton className="h-2.5 w-2/3" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        ) : playlists.length === 0 ? (
          <p className="px-3 py-1 text-[12px] leading-relaxed text-[var(--text-3)]">
            还没有歌单，点上面的加号建一个。
          </p>
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
                className={[ROW, active ? ROW_ACTIVE : ROW_IDLE].join(' ')}
              >
                <span className="truncate">{playlist.name}</span>
              </button>
            )
          })
        )}
      </div>

      <button
        type="button"
        onClick={() => setAuthOpen(true)}
        data-row="account"
        className="t flex shrink-0 items-center gap-2 border-t border-hairline px-3 py-2 text-left hover:bg-[var(--hover)]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-hairline text-[var(--text-3)]">
          <Icon name="user" size={13} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] text-[var(--text-1)]">
            {user?.uname ?? '未登录'}
          </span>
          <span className="block truncate text-[11px] text-[var(--text-3)]">
            {user ? '已连接 B 站' : '登录后同步'}
          </span>
        </span>
      </button>

      <CreatePlaylistModal open={creating} onClose={() => setCreating(false)} />
    </aside>
  )
}


export type { View }
