import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'

/** 从观看页回来时保留查找词与滚动位置；这里存的是账号视频，不是本地歌单。 */
const memory = { query: '', top: 0 }

/**
 * 赞过的视频。读的是 B 站账号里「赞过的视频」，不是本地临时列表——
 * 上一版只记本次会话点过的赞，重启就空，和账号里的记录对不上。
 */
export function LikedView() {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<WireError | null>(null)
  const [nonce, setNonce] = useState(0)
  const [query, setQuery] = useState(memory.query)
  const scroller = useRef<HTMLDivElement | null>(null)
  const navigate = useAppStore((state) => state.navigate)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const playContext = usePlayerStore((state) => state.playContext)

  useEffect(() => {
    memory.query = query
  }, [query])

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

  // 数据晚到，滚动位置要等列表渲染出来再恢复。
  useEffect(() => {
    if (tracks === null || !scroller.current || memory.top === 0) return
    scroller.current.scrollTop = memory.top
  }, [tracks])

  if (error) {
    const needLogin = error.class === 'needs_login'
    return (
      <EmptyState
        icon="heart"
        title={needLogin ? '登录后才能读到赞过的视频' : '赞过的视频没取到'}
        detail={needLogin ? '这份记录在 B 站账号里，本机没有副本。' : error.message}
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
          <BiliLoader label="正在取赞过的视频…" />
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

  const keyword = query.trim().toLowerCase()
  const filtered = keyword
    ? tracks.filter(
        (track) =>
          track.title.toLowerCase().includes(keyword) || track.artist.toLowerCase().includes(keyword),
      )
    : tracks

  return (
    <div
      id="scroll-main"
      ref={scroller}
      onScroll={(event) => {
        memory.top = event.currentTarget.scrollTop
      }}
      className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <PageTitle
        extra={keyword ? `${filtered.length}/${tracks.length}` : String(tracks.length)}
        action={
          <button
            type="button"
            aria-label={`听这 ${filtered.length} 个视频的声音`}
            onClick={() => void playContext(filtered.map((track) => track.key), 0)}
            className="t press flex h-8 items-center gap-2 rounded-[4px] border border-[var(--line)] px-3 text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Icon name="volume" size={13} />
            听全部
          </button>
        }
      >
        赞过的视频
      </PageTitle>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`在赞过的 ${tracks.length} 个视频里搜标题或 UP 主`}
          aria-label={`在账号赞过的 ${tracks.length} 个视频里按标题或 UP 主查找`}
          className="h-8 w-full max-w-[360px] rounded-[4px] border border-[var(--line)] bg-[var(--panel)] px-3 text-[13px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)] focus:border-[var(--accent)]"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="t shrink-0 text-[12px] text-[var(--text-3)] hover:text-[var(--text-1)]"
          >
            清除
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon="search"
            title="没有匹配的视频"
            detail="只在这个账号赞过的视频里按标题和 UP 主查找。"
            action={{ label: '清除查找', onClick: () => setQuery('') }}
            compact
          />
        </div>
      ) : (
        <ContentGrid tracks={filtered} activeKey={snapshot?.track?.key ?? null} playing={snapshot?.phase === 'playing'} />
      )}
    </div>
  )
}
