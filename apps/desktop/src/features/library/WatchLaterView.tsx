import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
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
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const playContext = usePlayerStore((s) => s.playContext)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<WireError | null>(null)
  const [attempt, setAttempt] = useState(0)

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
        if (!cancelled) setError(toWireError(e))
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  if (error) {
    const action =
      error.class === 'needs_login'
        ? { label: '去登录', onClick: () => setAuthOpen(true) }
        : error.class === 'retryable'
          ? { label: '重试', onClick: () => setAttempt((n) => n + 1) }
          : null
    return (
      <EmptyState
        icon="watchLater"
        title="稍后再看没取到"
        detail={error.message}
        action={action}
      />
    )
  }

  if (tracks === null) return <BiliLoader label="正在取稍后再看…" />

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
      <PageTitle
        extra={`${tracks.length} 个`}
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
        稍后再看
      </PageTitle>
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
