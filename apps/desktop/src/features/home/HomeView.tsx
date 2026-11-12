import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { ContentGrid } from '../tracks/ContentGrid'
import { PageTitle } from '../../shared/ui/PageTitle'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'
import { useAppStore } from '../../app/appStore'
import { PARTS } from '../../shared/lib/biliParts'
import { HeroBanner } from './HeroBanner'

/**
 * 发现页。
 *
 * 推荐接口是全站风控最严的一处，所以取数节奏跟着用户走：
 * 首屏 12 条，滚到底再取下一批（fresh_idx 递增），不后台预取。
 * 被拒时给明确文案和「换一批」，不假装有内容。
 */
export function HomeView() {
  const navigate = useAppStore((s) => s.navigate)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const [items, setItems] = useState<Track[]>([])
  const [fresh, setFresh] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 下一批的 fresh_idx。接口按它返回「另一批」，同值重复取会拿到一样的。 */
  const nextFresh = useRef(2)

  const load = useCallback(async (next: number, append = false): Promise<void> => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const list = await ipc.homeFeed(next)
      setItems((prev) => {
        if (!append) return list
        // 推荐流会重复推同一条，按 key 去重后再追加。
        const seen = new Set(prev.map((t) => t.key))
        return [...prev, ...list.filter((t) => !seen.has(t.key))]
      })
      if (list.length === 0) setError('这次没拿到推荐，换一批试试。')
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    nextFresh.current = 2
    void load(1)
  }, [load])

  const more = (): void => {
    if (loading || loadingMore) return
    const next = nextFresh.current
    nextFresh.current = next + 1
    void load(next, true)
  }

  return (
    <div
      id="scroll-main"
      onScroll={(event) => {
        const el = event.currentTarget
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) more()
      }}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-5 md:px-8"
    >
      <div className="mb-4 flex items-center gap-3">
        <PageTitle>发现</PageTitle>
        <button
          type="button"
          onClick={() => {
            const next = fresh + 1
            setFresh(next)
            nextFresh.current = 2
            void load(next)
          }}
          className="t press ml-auto rounded-[6px] border border-[var(--line)] px-2.5 py-1 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)]"
        >
          {/* 首次加载时列表还没出现，那是「正在取」而不是「正在换」。 */}
          {loading ? (items.length > 0 ? '正在换…' : '正在取…') : '换一批'}
        </button>
      </div>

      {/* B 站首页的频道条。每一项都落到对应分区的排行榜，不摆点不动的装饰。 */}
      <nav className="mb-3 flex items-center gap-0.5 overflow-x-auto border-b border-hairline pb-2">
        {PARTS.filter((part) => part.rid !== 0).map((part) => (
          <button
            key={part.rid}
            type="button"
            onClick={() => navigate({ kind: 'ranking', rid: part.rid })}
            className="t shrink-0 rounded-[4px] px-2.5 py-1 text-[13px] text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--accent)]"
          >
            {part.name}
          </button>
        ))}
      </nav>

      {error ? <p className="py-6 text-[13px] text-[var(--text-3)]">{error}</p> : null}

      <HeroBanner tracks={items} onOpen={(track) => navigate({ kind: 'watch', track })} />

      {items.length > 0 ? (
        <ContentGrid
          tracks={items}
          activeKey={activeKey}
          playing={playing}
        />
      ) : null}
      {loading && items.length === 0 ? <CardGridSkeleton cards={10} /> : null}
      {loadingMore ? (
        <p className="py-4 text-center text-[12px] text-[var(--text-3)]">正在加载更多…</p>
      ) : null}
    </div>
  )
}
