import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'

/**
 * 番剧频道。B 站番剧区的立绘是高封面（3:4），分数压在右下角。
 *
 * 一次取 42 部：接口一次给 99 条，取一半足够铺满一屏再往下翻一点。
 * 番剧播放要大会员与番剧页专用播放器，本机放不了，点开交给系统浏览器。
 */
export function BangumiView() {
  const [items, setItems] = useState<ipc.Bangumi[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void ipc
      .bangumiRank(42)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div id="scroll-main" className="bili-canvas min-h-0 flex-1 overflow-y-auto pb-10">
      <nav className="mb-4 bg-[var(--panel)] px-4 py-4 md:px-8">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[17px] font-medium text-[var(--text-1)]">番剧</h2>
          {items ? <span className="num text-[12px] text-[var(--text-3)]">{items.length}</span> : null}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-[12px] text-[var(--text-3)]">追番排行榜 · 近三天</p>
          <button
            type="button"
            onClick={() => void ipc.openExternal('https://www.bilibili.com/anime/').catch(() => {})}
            className="t press flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            <Icon name="info" size={12} />
            在浏览器里看
          </button>
        </div>
      </nav>
      {items === null ? (
        error ? (
          <EmptyState icon="alert" title="番剧榜没取到" detail={error} action={null} />
        ) : (
          <BiliLoader label="正在取番剧…" />
        )
      ) : items.length === 0 ? (
        <EmptyState icon="biliTv" title="番剧榜暂时是空的" action={null} />
      ) : (
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
                      item.rank === 1 ? '#fb7299' : item.rank === 2 ? '#ff8f3f' : item.rank === 3 ? '#f6c34a' : 'rgba(0,0,0,0.55)',
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
      )}
    </div>
  )
}
