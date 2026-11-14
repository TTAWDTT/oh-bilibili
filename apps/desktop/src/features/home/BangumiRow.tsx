import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { useAppStore } from '../../app/appStore'

/**
 * 发现页底部的番剧区。
 *
 * 数据是 B 站自己的番剧排行（`pgc/web/rank/list`），分数、更新进度、播放量
 * 都是接口原样给的展示串，不在这里二次编。番剧要在番剧页播放，点开交给浏览器。
 */
export function BangumiRow() {
  const navigate = useAppStore((state) => state.navigate)
  const [items, setItems] = useState<ipc.Bangumi[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void ipc
      .bangumiRank(6)
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

  if (error || !items || items.length === 0) return null

  return (
    <section className="mt-8 px-4 md:px-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-medium text-[var(--text-1)]">番剧</h2>
        <button
          type="button"
          onClick={() => navigate({ kind: 'bangumi' })}
          className="t press flex items-center gap-1 text-[12.5px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          全部番剧
          <span aria-hidden>›</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
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
              {/* 名次压在左上角，前三名用 B 站的粉 / 橙 / 黄 */}
              <span
                className="num absolute left-0 top-0 px-1.5 text-[12px] font-medium leading-[18px] text-white"
                style={{
                  background: item.rank === 1 ? 'var(--accent)' : item.rank === 2 ? '#ff8f3f' : item.rank === 3 ? '#f6c34a' : 'rgba(0,0,0,0.55)',
                }}
              >
                {item.rank}
              </span>
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1.5 pb-1 text-[11px] leading-[15px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                <span className="num truncate">{item.play_text}</span>
                {/* 未开分的番剧 rating 是空串，这时只留播放量，别显示一个空的金色块 */}
                {item.rating ? <span className="num shrink-0 text-[#ffe0a3]">{item.rating}</span> : null}
              </span>
            </span>
            <span className="mt-1.5 line-clamp-1 text-[13.5px] leading-[19px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
              {item.title}
            </span>
            <span className="mt-0.5 line-clamp-1 text-[12px] text-[var(--text-3)]">{item.index_show}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
