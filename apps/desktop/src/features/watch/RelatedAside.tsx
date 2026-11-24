import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { useAutoplay } from './autoplay'

/** 观看页右栏：相关推荐。条目全来自接口，点击进入它自己的观看页。 */
export function RelatedAside({ items, inline = false }: { items: Track[]; inline?: boolean }) {
  const replace = useAppStore((s) => s.replace)
  const autoplay = useAutoplay((s) => s.enabled)
  const setAutoplay = useAutoplay((s) => s.setEnabled)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const keys = items.map((item) => item.key)
    if (keys.length === 0) return
    let alive = true
    void ipc
      .historyPositions(keys)
      .then((rows) => {
        if (alive) setProgress(Object.fromEntries(rows))
      })
      .catch(() => {
        // 历史读不到就不画进度，推荐本身照常显示
      })
    return () => {
      alive = false
    }
  }, [items])
  if (items.length === 0) return null

  return (
    <div className={`watch-related ${inline ? 'watch-related-inline' : ''}`}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[17px] font-semibold text-[var(--text-1)]">接下来播放</h3>
        <span className="num text-[11px] text-[var(--text-3)]">{items.length} 条</span>
        {/* B 站把自动连播开关挂在相关推荐标题行右侧：不开播完不跳，不用等倒计时才关。 */}
        <button
          type="button"
          role="switch"
          aria-checked={autoplay}
          aria-label="自动连播"
          onClick={() => setAutoplay(!autoplay)}
          className="t press ml-auto flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          自动连播
          <span
            className={`relative flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
              autoplay ? 'bg-[var(--accent)]' : 'bg-[var(--ga3)]'
            }`}
          >
            <span
              className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                autoplay ? 'translate-x-3' : 'translate-x-0'
              }`}
            />
          </span>
        </button>
      </div>
      <div className="watch-related-list">
        {(inline && !expanded ? items.slice(0, 3) : items).map((item) => (
          <button
            key={item.key}
            type="button"
            data-related-item={item.key}
            onClick={() => replace({ kind: 'watch', track: item })}
            title={item.title}
            className="watch-related-entry group"
          >
            <span
              className="relative aspect-video overflow-hidden rounded-[6px]"
            >
              <Cover cover={item.cover} title={item.title} width={160} className="h-full w-full" />
              {/* B 站相关推荐的封面右下角挂着时长，扫一眼就知道要花多久。 */}
              {item.duration_ms ? (
                <span className="num absolute bottom-0.5 right-1 rounded-[2px] bg-black/65 px-1 text-[10px] leading-[14px] text-white">
                  {formatDuration(item.duration_ms)}
                </span>
              ) : null}
              {item.duration_ms && (progress[item.key] ?? 0) > 0 ? (
                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/45">
                  <span
                    className="block h-full bg-[var(--accent)]"
                    style={{
                      width: `${Math.min(100, ((progress[item.key] ?? 0) / item.duration_ms) * 100)}%`,
                    }}
                  />
                </span>
              ) : null}
              <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
                  <Icon name="play" size={14} />
                </span>
              </span>
            </span>
            <span className="flex min-w-0 flex-col self-stretch">
              <span className="line-clamp-2 text-[14px] leading-[1.35] font-medium text-[var(--text-1)] group-hover:text-[var(--accent)]">
                {item.title}
              </span>
              {item.artist && <span className="mt-1 block truncate text-[12px] leading-[16px] text-[var(--text-2)]">{item.artist}</span>}
              <span className="mt-auto flex min-w-0 items-center gap-2 pt-0.5 text-[11px] leading-[14px] text-[var(--text-3)]">
                {item.views ? (
                  <span className="num flex shrink-0 items-center gap-0.5">
                    <Icon name="play" size={10} />
                    {formatCount(item.views)}
                  </span>
                ) : null}
                {(item.danmaku ?? 0) > 0 ? (
                  <span className="num flex shrink-0 items-center gap-0.5">
                    <Icon name="danmaku" size={11} />
                    {formatCount(item.danmaku!)}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        ))}
      </div>
      {inline && items.length > 3 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="t mt-3 flex min-h-8 w-full items-center justify-center gap-1 rounded-[6px] bg-[var(--panel-alt)] text-[12px] text-[var(--text-2)] hover:text-[var(--accent)]"
        >
          {expanded ? '收起推荐' : `展开其余 ${items.length - 3} 条推荐`}
          <Icon name="chevronRight" size={13} className={expanded ? '-rotate-90' : 'rotate-90'} />
        </button>
      ) : null}
    </div>
  )
}
