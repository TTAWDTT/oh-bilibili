import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { useAppStore } from '../../app/appStore'
import { Icon } from '../../shared/ui/Icon'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { WideCard } from '../tracks/WideCard'
import { HotTabs } from './HotTabs'

/**
 * 热门。B 站的综合热门（popular/all）：按时间往下翻，一次 50 条，没有名次。
 * 接口用 `no_more` 说到头，之后不再请求。
 */
export function PopularView() {
  /** 接口给的小标签按 key 存：换批、翻页都不乱。 */
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nonce, setNonce] = useState(0)
  /** 下一页的页码。取成功才往前走，失败重试拿的还是同一页。 */
  const nextPage = useRef(2)
  /** 滚动事件会连着触发，请求在飞的时候用 ref 挡住重入。 */
  const pending = useRef(false)
  const noMore = useRef(false)
  const navigate = useAppStore((state) => state.navigate)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    pending.current = true
    nextPage.current = 2
    noMore.current = false
    setTracks(null)
    setError(null)
    void ipc
      .popular(1)
      .then((page) => {
        if (cancelled) return
        setTracks(page.items.map((item) => item.track))
        setNotes(
          Object.fromEntries(
            page.items.filter((item) => item.note).map((item) => [item.track.key, item.note]),
          ),
        )
        noMore.current = page.no_more
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
      .finally(() => {
        // 卸载后这次请求的结果不再属于这一屏，别把重新挂载后的请求标记清掉。
        if (!cancelled) pending.current = false
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  const more = (): void => {
    if (pending.current || noMore.current) return
    const page = nextPage.current
    pending.current = true
    setLoadingMore(true)
    setError(null)
    void ipc
      .popular(page)
      .then((next) => {
        nextPage.current = page + 1
        const list = next.items.map((item) => item.track)
        // 实测翻到第 11 页时接口回空列表但 no_more 仍是 false；
        // 只看 no_more 的话，深预取会对着空页无限翻下去。
        noMore.current = next.no_more || list.length === 0
        if (list.length > 0) {
          setNotes((prev) => ({
            ...prev,
            ...Object.fromEntries(
              next.items.filter((item) => item.note).map((item) => [item.track.key, item.note]),
            ),
          }))
        }
        if (list.length > 0) setTracks((prev) => [...(prev ?? []), ...list])
      })
      .catch((cause) => setError(toWireError(cause).message))
      .finally(() => {
        pending.current = false
        setLoadingMore(false)
      })
  }

  /** 原来靠 ContentGrid 的 onNeedMore 触发翻页；换成两列大卡后由底部哨兵接管。 */
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !error) more()
      },
      { root: document.getElementById('scroll-main'), rootMargin: '900px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [error, tracks])

  return (
    <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto pb-10">
      <HotTabs
        active="popular"
        title="热门"
        extra={tracks ? String(tracks.length) : undefined}
        aside={
          <button
            type="button"
            onClick={() => void ipc.openExternal('https://www.bilibili.com/v/popular/all').catch(() => {})}
            className="t press flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            <Icon name="info" size={12} />
            热门规则
          </button>
        }
      >
        <p className="text-[12px] text-[var(--text-3)]">各个领域中新奇好玩的优质内容都在这里~</p>
      </HotTabs>
      <div className="px-4 md:px-8">
        {tracks === null ? (
          error ? (
            <EmptyState
              icon="alert"
              title="热门没取到"
              detail={error}
              action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }}
            />
          ) : (
            <CardGridSkeleton cards={8} />
          )
        ) : tracks.length === 0 ? (
          <EmptyState mascot="missYou" icon="biliTv" title="热门榜暂时是空的" action={null} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2">
              {tracks.map((track) => (
                <WideCard
                  key={track.key}
                  track={track}
                  note={notes[track.key] ?? null}
                  noteAsTag
                  onOpen={() => navigate({ kind: 'watch', track })}
                />
              ))}
            </div>
            <div ref={sentinelRef} className="h-1" aria-hidden />
            {error ? (
              <div className="flex items-center justify-center gap-3 py-4 text-[12px] text-[var(--text-3)]">
                <span>{error}</span>
                <button type="button" onClick={more} className="t press text-[var(--accent)] hover:underline">
                  重试
                </button>
              </div>
            ) : loadingMore ? (
              <BiliLoader compact label="正在加载更多…" />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
