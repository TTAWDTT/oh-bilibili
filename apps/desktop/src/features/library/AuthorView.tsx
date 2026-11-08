import { toastDone, toastFailure } from '../../app/notice'
import { toWireError } from '../../shared/lib/errors'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { Avatar } from '../../shared/ui/Avatar'
import { EmptyState } from '../../shared/ui/EmptyState'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { TrackGrid } from '../tracks/TrackGrid'
import { usePlayerStore } from '../player/playerStore'

function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(n)
}

/**
 * UP 主页面。
 *
 * B 站的用户空间接口被风控（-352），所以这里用「按作者名搜索」的结果聚合：
 * 头像取他最近一条投稿的 upic，统计是当前结果集内的，界面上如实标注。
 */
export function AuthorView({ name }: { name: string }) {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const navigate = useAppStore((state) => state.navigate)
  const [followed, setFollowed] = useState(false)

  /** 关注是真接口：写进你的 B 站关注列表，取关同理。 */
  const follow = async (): Promise<void> => {
    const mid = tracks?.find((t) => t.up_mid)?.up_mid
    if (!mid) {
      toastFailure('关注', { class: 'input', message: '这条结果没带 UP 主的 uid' })
      return
    }
    const next = !followed
    setFollowed(next)
    try {
      await ipc.followSet(mid, next)
      toastDone(next ? '已关注' : '已取消关注')
    } catch (e) {
      setFollowed(!next)
      toastFailure('关注', toWireError(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    void ipc
      .searchQ(name, 1)
      .then((list) => {
        if (!cancelled) setTracks(list.filter((t) => t.artist === name))
      })
      .catch(() => {
        if (!cancelled) setTracks([])
      })
    return () => {
      cancelled = true
    }
  }, [name])

  if (tracks === null) return <TrackListSkeleton rows={6} />
  if (tracks.length === 0) {
    return (
      <EmptyState
        icon="biliTv"
        title="没找到这个 UP 主"
        detail="B 站的用户空间接口目前有风控，只能按名字搜到他的投稿。"
        action={{ label: '回到搜索', onClick: () => navigate({ kind: 'search' }) }}
      />
    )
  }

  const avatar = tracks.find((t) => t.up_avatar)?.up_avatar ?? null
  const views = tracks.reduce((sum, t) => sum + (t.views ?? 0), 0)

  return (
    <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-6">
      <header className="mb-6 flex items-center gap-4">
        <Avatar src={avatar} alt={name} size={64} />
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold text-[var(--text-1)]" title={name}>
            {name}
          </h1>
          <button
            type="button"
            onClick={() => void follow()}
            className={[
              'mt-2 flex items-center gap-1 rounded-[4px] px-3 py-1 text-[14px]',
              followed
                ? 'border border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)]'
                : 'bg-[var(--accent)] text-white',
            ].join(' ')}
          >
            {followed ? '已关注' : '+ 关注'}
          </button>

          <div className="num mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--text-3)]">
            <span>{tracks.length} 个投稿</span>
            <span>{formatCount(views)} 累计播放</span>
            <span className="rounded-[2px] bg-[var(--panel-raised)] px-1.5 leading-[16px]">
              来自搜索结果
            </span>
          </div>
        </div>
      </header>

      <TrackGrid
        tracks={tracks}
        activeKey={snapshot?.track?.key ?? null}
        playing={snapshot?.phase === 'playing'}
      />
    </div>
  )
}
