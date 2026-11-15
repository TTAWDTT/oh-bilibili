import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { useAuthStore } from '../auth/authStore'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { BangumiTimeline } from './BangumiTimeline'

const TABS = [
  { type: 1, label: '番剧', url: 'https://www.bilibili.com/anime/' },
  { type: 2, label: '电影', url: 'https://www.bilibili.com/movie/' },
  { type: 3, label: '纪录片', url: 'https://www.bilibili.com/documentary/' },
  { type: 4, label: '国创', url: 'https://www.bilibili.com/guochuang/' },
  { type: 5, label: '电视剧', url: 'https://www.bilibili.com/tv/' },
  { type: 0, label: '追番', url: '' },
] as const

/** 番剧频道使用高封面，播放交给系统浏览器。 */
export function BangumiView() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [seasonType, setSeasonType] = useState(1)
  const [nonce, setNonce] = useState(0)
  const [items, setItems] = useState<ipc.Bangumi[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [needLogin, setNeedLogin] = useState(false)
  const loadMoreRef = useRef<() => void>(() => {})
  const auth = useAuthStore((state) => state.auth)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const activeTab = TABS.find((tab) => tab.type === seasonType) ?? TABS[0]

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    setTotal(null)
    setPage(0)
    setLoadingMore(false)
    setNeedLogin(false)
    loadMoreRef.current = () => {}
    scrollRef.current?.scrollTo({ top: 0 })

    if (seasonType === 0) {
      if (!auth?.logged_in) return
      let pending = false
      let nextPage = 1
      let followed: ipc.Bangumi[] = []
      let count = 0
      const load = async () => {
        if (pending || cancelled || (nextPage > 1 && followed.length >= count)) return
        pending = true
        setError(null)
        setLoadingMore(nextPage > 1)
        try {
          const [list, total] = await ipc.followedBangumi(nextPage)
          if (cancelled) return
          const seen = new Set(followed.map((item) => item.season_id))
          followed = [...followed, ...list.filter((item) => {
            if (seen.has(item.season_id)) return false
            seen.add(item.season_id)
            return true
          })]
          count = total
          setItems(followed)
          setTotal(total)
          setPage(nextPage)
          nextPage += 1
        } catch (cause) {
          if (!cancelled) {
            const failure = toWireError(cause)
            setError(failure.message)
            if (failure.class === 'needs_login') setNeedLogin(true)
          }
        } finally {
          if (!cancelled) {
            pending = false
            setLoadingMore(false)
          }
        }
      }
      loadMoreRef.current = () => void load()
      void load()
    } else {
      void ipc
        .bangumiRank(42, seasonType)
        .then((list) => {
          if (!cancelled) setItems(list)
        })
        .catch((cause) => {
          if (!cancelled) setError(toWireError(cause).message)
        })
    }
    return () => {
      cancelled = true
    }
  }, [seasonType, nonce, auth])

  const hasMore = seasonType === 0 && page > 0 && items !== null && total !== null && items.length < total

  const onScroll = () => {
    const box = scrollRef.current
    if (hasMore && !error && box && box.scrollHeight - box.scrollTop - box.clientHeight < 600) {
      loadMoreRef.current()
    }
  }

  return (
    <div ref={scrollRef} id="scroll-main" onScroll={onScroll} className="bili-canvas min-h-0 flex-1 overflow-y-auto pb-10">
      <nav className="mb-4 bg-[var(--panel)] px-4 pt-4 md:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-medium text-[var(--text-1)]">番剧</h2>
          {seasonType === 0 ? (
            total !== null ? <span className="text-[12px] text-[var(--text-3)]">共 {total} 部</span> : null
          ) : (
            <button
              type="button"
              onClick={() => void ipc.openExternal(activeTab.url).catch(() => {})}
              className="t press flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
            >
              <Icon name="info" size={12} />
              在浏览器里看
            </button>
          )}
        </div>
        <div className="no-scrollbar flex items-center gap-5 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.type}
              type="button"
              aria-pressed={seasonType === tab.type}
              onClick={() => setSeasonType(tab.type)}
              className={`t shrink-0 whitespace-nowrap border-b-2 pb-2 text-[14px] ${
                seasonType === tab.type
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-2)] hover:text-[var(--accent)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
      {seasonType === 0 && !auth ? (
        <BiliLoader label="正在确认登录状态…" />
      ) : seasonType === 0 && (auth?.logged_in !== true || needLogin) ? (
        <EmptyState icon="biliTv" title="登录后查看追番" action={{ label: '登录', onClick: () => setAuthOpen(true) }} />
      ) : items === null ? (
        error ? (
          <EmptyState icon="alert" title={seasonType === 0 ? '追番没取到' : '榜单没取到'} detail={error} action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }} />
        ) : (
          <BiliLoader label={seasonType === 0 ? '正在取追番…' : '正在取榜单…'} />
        )
      ) : items.length === 0 ? (
        seasonType === 0 ? (
          <EmptyState icon="biliTv" title="还没有追番" action={{ label: '去番剧', onClick: () => setSeasonType(1) }} />
        ) : (
          <EmptyState icon="biliTv" title="榜单暂时是空的" action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }} />
        )
      ) : (
        <>
          {seasonType === 1 ? (
            <div className="px-4 md:px-8">
              <BangumiTimeline />
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-x-3 gap-y-6 px-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 md:px-8">
            {items.map((item) => (
              <button
                key={item.season_id}
                type="button"
                onClick={() => void ipc.openExternal(item.url).catch(() => {})}
                title={item.title}
                className="group min-w-0 text-left"
              >
                <span className="relative block overflow-hidden rounded-[6px] bg-[var(--ga1)]" style={{ aspectRatio: '3 / 4' }}>
                  {item.cover ? (
                    <img
                      src={item.cover}
                      alt=""
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-[220ms] group-hover:scale-[1.03]"
                    />
                  ) : null}
                  {item.rank > 0 ? (
                    <span
                      className="num absolute left-0 top-0 px-1.5 text-[12px] font-medium leading-[18px] text-white"
                      style={{
                        background:
                          item.rank === 1 ? 'var(--accent)' : item.rank === 2 ? '#ff8f3f' : item.rank === 3 ? '#f6c34a' : 'rgba(0,0,0,0.55)',
                      }}
                    >
                      {item.rank}
                    </span>
                  ) : null}
                  {item.rating ? (
                    <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/55 px-1 text-[11px] leading-[15px] text-[#ffe0a3]">
                      {item.rating}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1.5 line-clamp-2 min-h-[38px] text-[13.5px] leading-[19px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                  {item.title}
                </span>
                <span className="mt-0.5 line-clamp-1 text-[12px] text-[var(--text-3)]">
                  {item.index_show || item.play_text}
                </span>
              </button>
            ))}
          </div>
          {hasMore ? (
            <div className="mt-6 flex flex-col items-center gap-2 px-4">
              {error ? <p className="text-[12px] text-[var(--text-3)]">{error}</p> : null}
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => loadMoreRef.current()}
                className="t press rounded-[6px] border border-[var(--line)] px-5 py-2 text-[13px] text-[var(--text-2)] hover:text-[var(--accent)] disabled:opacity-50"
              >
                {loadingMore ? '加载中…' : error ? '重试' : '加载更多'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
