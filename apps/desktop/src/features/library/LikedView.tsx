import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'

/**
 * 喜欢。读的是 B 站账号里「赞过的视频」，不是本地临时列表——
 * 上一版只记本次会话点过的赞，重启就空，和账号里的记录对不上。
 */
export function LikedView() {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<WireError | null>(null)
  const [nonce, setNonce] = useState(0)
  const navigate = useAppStore((state) => state.navigate)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const playContext = usePlayerStore((state) => state.playContext)

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    setError(null)
    void ipc
      .likedVideos()
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  if (error) {
    const needLogin = error.class === 'needs_login'
    return (
      <EmptyState
        icon="heart"
        title={needLogin ? '登录后才能读到赞过的视频' : '赞过的视频没取到'}
        detail={needLogin ? '喜欢记在 B 站账号里，本机没有副本。' : error.message}
        action={
          needLogin
            ? { label: '去登录', onClick: () => setAuthOpen(true) }
            : { label: '重试', onClick: () => setNonce((n) => n + 1) }
        }
      />
    )
  }

  if (tracks === null) {
    return (
      <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
        <PageTitle>赞过的视频</PageTitle>
        <div className="mt-4">
          <CardGridSkeleton cards={8} />
        </div>
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <EmptyState
        mascot="heart"
        icon="heart"
        title="还没有赞过的视频"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  return (
    <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <PageTitle
        extra={String(tracks.length)}
        action={
          <button
            type="button"
            onClick={() => void playContext(tracks.map((t) => t.key), 0)}
            className="t press flex h-8 items-center gap-2 rounded-[4px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90"
          >
            <Icon name="play" size={13} />
            播放全部
          </button>
        }
      >
        赞过的视频
      </PageTitle>
      <ContentGrid tracks={tracks} activeKey={snapshot?.track?.key ?? null} playing={snapshot?.phase === 'playing'} />
    </div>
  )
}
