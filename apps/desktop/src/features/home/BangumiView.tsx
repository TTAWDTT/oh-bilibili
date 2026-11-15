import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { BangumiTimeline } from './BangumiTimeline'

const TABS = [
  { type: 1, label: '番剧' },
  { type: 2, label: '电影' },
  { type: 3, label: '纪录片' },
  { type: 4, label: '国创' },
  { type: 5, label: '电视剧' },
]

/** 番剧频道使用高封面，播放交给系统浏览器。 */
export function BangumiView() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [seasonType, setSeasonType] = useState(1)
  const [nonce, setNonce] = useState(0)
  const [items, setItems] = useState<ipc.Bangumi[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    scrollRef.current?.scrollTo({ top: 0 })
    void ipc
      .bangumiRank(42, seasonType)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [seasonType, nonce])

  return (
    <div ref={scrollRef} id="scroll-main" className="bili-canvas min-h-0 flex-1 overflow-y-auto pb-10">
      <nav className="mb-4 bg-[var(--panel)] px-4 pt-4 md:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-medium text-[var(--text-1)]">番剧</h2>
          <button
            type="button"
            onClick={() => void ipc.openExternal('https://www.bilibili.com/anime/').catch(() => {})}
            className="t press flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            <Icon name="info" size={12} />
            在浏览器里看
          </button>
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
      {items === null ? (
        error ? (
          <EmptyState icon="alert" title="榜单没取到" detail={error} action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }} />
        ) : (
          <BiliLoader label="正在取榜单…" />
        )
      ) : items.length === 0 ? (
        <EmptyState icon="biliTv" title="榜单暂时是空的" action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }} />
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
                <span
                  className="num absolute left-0 top-0 px-1.5 text-[12px] font-medium leading-[18px] text-white"
                  style={{
                    background:
                      item.rank === 1 ? 'var(--accent)' : item.rank === 2 ? '#ff8f3f' : item.rank === 3 ? '#f6c34a' : 'rgba(0,0,0,0.55)',
                  }}
                >
                  {item.rank}
                </span>
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
        </>
      )}
    </div>
  )
}
