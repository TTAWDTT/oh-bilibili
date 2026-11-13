import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { PageTitle } from '../../shared/ui/PageTitle'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { PREFETCH_PX } from '../../shared/lib/prefetch'
import { BiliLoader } from '../../shared/ui/BiliLoader'

/**
 * 热门。B 站的综合热门（popular/all）：按时间往下翻，一次 50 条，没有名次。
 * 接口用 `no_more` 说到头，之后不再请求。
 */
export function PopularView() {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nonce, setNonce] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 下一页的页码。取成功才往前走，失败重试拿的还是同一页。 */
  const nextPage = useRef(2)
  /** 滚动事件会连着触发，请求在飞的时候用 ref 挡住重入。 */
  const pending = useRef(false)
  const noMore = useRef(false)
  const snapshot = usePlayerStore((state) => state.snapshot)

  useEffect(() => {
    let cancelled = false
    pending.current = true
    nextPage.current = 2
    noMore.current = false
    setTracks(null)
    setError(null)
    void ipc
      .popular(1)
      .then(([list, end]) => {
        if (cancelled) return
        setTracks(list)
        noMore.current = end
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
      .then(([list, end]) => {
        nextPage.current = page + 1
        // 实测翻到第 11 页时接口回空列表但 no_more 仍是 false；
        // 只看 no_more 的话，深预取会对着空页无限翻下去。
        noMore.current = end || list.length === 0
        if (list.length > 0) setTracks((prev) => [...(prev ?? []), ...list])
      })
      .catch((cause) => setError(toWireError(cause).message))
      .finally(() => {
        pending.current = false
        setLoadingMore(false)
      })
  }

  // 取回一页后缓冲还不够深就继续取。热门一页 50 条约三四屏，
  // 只在滚动时触发的话，用户滑到页尾仍会撞上「正在加载更多」。
  useEffect(() => {
    if (tracks === null || loadingMore || error) return
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < PREFETCH_PX) more()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, loadingMore, error])

  return (
    <div
      ref={scrollRef}
      id="scroll-main"
      onScroll={(event) => {
        const el = event.currentTarget
        // 出错后停在底部等用户按重试，滚动不再自动重发。
        if (error) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < PREFETCH_PX) more()
      }}
      className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <PageTitle extra={tracks ? String(tracks.length) : undefined}>热门</PageTitle>
      {tracks === null ? (
        error ? (
          <EmptyState
            icon="alert"
            title="热门没取到"
            detail={error}
            action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }}
          />
        ) : (
          <CardGridSkeleton cards={10} />
        )
      ) : tracks.length === 0 ? (
        <EmptyState icon="biliTv" title="热门榜暂时是空的" action={null} />
      ) : (
        <>
          <ContentGrid
            tracks={tracks}
            activeKey={snapshot?.track?.key ?? null}
            playing={snapshot?.phase === 'playing'}
          />
          {error ? (
            <div className="flex items-center justify-center gap-3 py-4 text-[12px] text-[var(--text-3)]">
              <span>{error}</span>
              <button
                type="button"
                onClick={more}
                className="t press text-[var(--accent)] hover:underline"
              >
                重试
              </button>
            </div>
          ) : loadingMore ? (
            <BiliLoader compact label="正在加载更多…" />
          ) : null}
        </>
      )}
    </div>
  )
}
