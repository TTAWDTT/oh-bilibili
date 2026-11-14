import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { ContentGrid } from '../tracks/ContentGrid'
import { PageTitle } from '../../shared/ui/PageTitle'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'
import { useAppStore } from '../../app/appStore'
import { PARTS, partColor } from '../../shared/lib/biliParts'
import { HeroBanner } from './HeroBanner'
import { BiliLoader } from '../../shared/ui/BiliLoader'

/**
 * 发现页。
 *
 * 推荐接口是全站风控最严的一处，所以取数节奏跟着用户走：
 * 首屏 12 条，滚到底再取下一批（fresh_idx 递增），不后台预取。
 * 被拒时给明确文案和「换一批」，不假装有内容。
 */

/** 按会话记住这一屏：从视频页返回时，推荐流和滚动位置都要原样回来。 */
const feedMemory: { items: Track[]; fresh: number; nextFresh: number; scrollTop: number; index: number } = {
  items: [],
  fresh: 1,
  nextFresh: 2,
  scrollTop: 0,
  index: 0,
}
export function HomeView() {
  const navigate = useAppStore((s) => s.navigate)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const [items, setItems] = useState<Track[]>(feedMemory.items)
  /** 当前这批曲目的镜像。去重要在 setState 之外算，不然「新增了几条」永远是旧值。 */
  const itemsRef = useRef<Track[]>(feedMemory.items)
  const [fresh, setFresh] = useState(feedMemory.fresh)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 下一批的 fresh_idx。接口按它返回「另一批」，同值重复取会拿到一样的。 */
  const nextFresh = useRef(feedMemory.nextFresh)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** 滚动事件比 React 状态回写快，用它挡住同一批的重复请求。 */
  const pending = useRef(false)
  /** 上一批一条新的都没带回来，就说明推荐流到头了，别再自动补。 */
  const exhausted = useRef(false)

  const load = useCallback(async (next: number, append = false): Promise<void> => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const list = await ipc.homeFeed(next)
      // 推荐流会重复推同一条，按 key 去重后再追加。
      const base = append ? itemsRef.current : []
      const seen = new Set(base.map((t) => t.key))
      const fresh = append ? list.filter((t) => !seen.has(t.key)) : list
      // 整批都是见过的：继续取只会原地打转，而且新数组会让预取 effect 再跑一轮。
      if (append && fresh.length === 0) {
        exhausted.current = true
        setError('这一轮的推荐已经到底了，换一批看看。')
        return
      }
      const merged = [...base, ...fresh]
      itemsRef.current = merged
      setItems(merged)
      if (list.length === 0) {
        if (append) exhausted.current = true
        setError(append ? '这一轮的推荐已经到底了，换一批看看。' : '这次没拿到推荐，换一批试试。')
      }
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    nextFresh.current = feedMemory.nextFresh
    if (feedMemory.items.length === 0) void load(1)
  }, [load])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    // 窗口化后滚动高度只代表已挂出来的这一段，按「第几条」恢复才落得回原处。
    const card =
      feedMemory.index > 0
        ? el.querySelector<HTMLElement>(`[data-track-card][data-index="${feedMemory.index}"]`)
        : null
    if (card) {
      el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
    } else if (feedMemory.items.length > 0) {
      el.scrollTop = feedMemory.scrollTop
    }
  }, [])

  useEffect(() => {
    feedMemory.items = items
  }, [items])

  useEffect(() => {
    feedMemory.fresh = fresh
  }, [fresh])

  const more = (): void => {
    // 到底了就不再请求：滚动事件会一直触发，不挡住就是无限空请求。
    if (pending.current || loading || loadingMore || exhausted.current) return
    pending.current = true
    const next = nextFresh.current
    nextFresh.current = next + 1
    feedMemory.nextFresh = next + 1
    void load(next, true).finally(() => {
      pending.current = false
    })
  }

  return (
    <div
      ref={scrollerRef}
      id="scroll-main"
      onScroll={(event) => {
        const el = event.currentTarget
        feedMemory.scrollTop = el.scrollTop
        const max = el.scrollHeight - el.clientHeight
        // 滚动高度只覆盖已挂出来的卡片，比例要按渲染窗口算，不能按取回的条数算。
        const rendered = Number(el.querySelector<HTMLElement>('[data-shown]')?.dataset.shown ?? 0)
        if (max > 0 && rendered > 1) {
          feedMemory.index = Math.round((el.scrollTop / max) * (rendered - 1))
        }
      }}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-5 md:px-8"
    >
      <div className="mb-4 flex items-center gap-3">
        <PageTitle>发现</PageTitle>
        <button
          type="button"
          onClick={() => {
            const next = fresh + 1
            itemsRef.current = []
            setFresh(next)
            nextFresh.current = 2
            feedMemory.nextFresh = 2
            feedMemory.scrollTop = 0
            feedMemory.index = 0
            exhausted.current = false
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
            className="t flex shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[13px] text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--accent)]"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: partColor(part.name) }} />
            {part.name}
          </button>
        ))}
      </nav>

      {/* 首屏没内容才把错误摆在顶部；已经有一屏推荐时，这句话属于列表末尾。 */}
      {error && items.length === 0 ? (
        <p className="py-6 text-[13px] text-[var(--text-3)]">{error}</p>
      ) : null}

      <HeroBanner tracks={items} onOpen={(track) => navigate({ kind: 'watch', track })} />

      {items.length > 0 ? (
        <ContentGrid
          tracks={items}
          activeKey={activeKey}
          playing={playing}
          onNeedMore={more}
          lookahead={600}
          initialIndex={feedMemory.index}
        />
      ) : null}
      {loading && items.length === 0 ? <CardGridSkeleton cards={10} /> : null}
      {loadingMore ? <BiliLoader compact label="正在加载更多…" /> : null}
      {error && items.length > 0 ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--text-3)]">{error}</p>
      ) : null}
    </div>
  )
}
