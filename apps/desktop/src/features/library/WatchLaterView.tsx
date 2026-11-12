import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { EmptyState } from '../../shared/ui/EmptyState'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { PageTitle } from '../../shared/ui/PageTitle'
import { Icon } from '../../shared/ui/Icon'
import { reportActionError } from '../../shared/lib/actionError'
import { toastDone } from '../../app/notice'

/**
 * 稍后再看。
 *
 * 一条接口响应就带全卡片数据，所以不需要逐条查详情。
 */
export function WatchLaterView() {
  const navigate = useAppStore((s) => s.navigate)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const removeOne = async (key: string): Promise<void> => {
    try {
      await ipc.watchLaterSet(key, false)
      setTracks((prev) => (prev ?? []).filter((track) => track.key !== key))
      toastDone('已从稍后再看移除')
    } catch (e) {
      reportActionError('移出稍后再看', e)
    }
  }

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    setError(null)
    void ipc
      .watchLaterList()
      .then((list) => {
        if (!cancelled) setTracks(list)
      })
      .catch((e) => {
        if (!cancelled) {
          setTracks([])
          setError(toWireError(e).message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (tracks === null) return <TrackListSkeleton rows={6} />

  if (error) {
    return (
      <EmptyState
        icon="watchLater"
        title="稍后再看没取到"
        detail={error}
        action={{ label: '去登录', onClick: () => navigate({ kind: 'settings' }) }}
      />
    )
  }

  if (tracks.length === 0) {
    return (
      <EmptyState
        icon="watchLater"
        title="还没有稍后再看"
        detail="在观看页点「稍后再看」，视频会出现在这里。"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  return (
    <div
      id="scroll-main"
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <PageTitle extra={`${tracks.length} 个`}>稍后再看</PageTitle>
      <ContentGrid
        tracks={tracks}
        activeKey={activeKey}
        playing={playing}
        extraAction={(track) => (
          <button
            type="button"
            aria-label={`移除 ${track.title}`}
            title="从稍后再看移除"
            onClick={() => void removeOne(track.key)}
            className="t press text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            <Icon name="close" size={12} />
          </button>
        )}
      />
    </div>
  )
}
