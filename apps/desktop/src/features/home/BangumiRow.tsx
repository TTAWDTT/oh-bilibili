import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { useAppStore } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import { Icon } from '../../shared/ui/Icon'
import './discovery-shelves.css'

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
      .bangumiRank(6, 1)
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
    <section className="discovery-shelf px-4 md:px-8" aria-labelledby="home-bangumi-heading">
      <div className="discovery-shelf-heading">
        <h2 id="home-bangumi-heading" className="discovery-heading">番剧</h2>
        <span className="discovery-browser-note"><Icon name="external" size={12} />在浏览器观看</span>
        <button type="button" onClick={() => navigate({ kind: 'bangumi' })}>
          全部番剧 <Icon name="chevronRight" size={14} />
        </button>
      </div>
      <ol className="discovery-poster-list">
        {items.map((item) => (
          <li key={item.season_id} className="min-w-0">
            <button
              type="button"
              onClick={() => void ipc.openExternal(item.url).catch((cause) => toastFailure('打开番剧', cause))}
              title={`${item.title} · 在浏览器打开`}
              className="discovery-poster-card"
            >
              <span className="discovery-poster-art">
                {item.cover && (
                  <img src={item.cover} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                )}
                <span className="discovery-cover-stats justify-between num">
                  <span className="truncate">{item.play_text}</span>
                  {item.rating && <span className="shrink-0">{item.rating}</span>}
                </span>
                <span className="discovery-open-label">在浏览器打开 <Icon name="external" size={11} /></span>
              </span>
              <span className="discovery-card-title">{item.title}</span>
              <span className="discovery-card-meta">
                {item.index_show && <span className="truncate">{item.index_show}</span>}
                {item.rank > 0 && <span className="ml-auto shrink-0 num">第 {item.rank} 名</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
