import { useEffect, useRef } from 'react'
import { useAppStore } from '../../app/appStore'
import type { SeasonView } from '../../shared/lib/contract'
import { formatCount, formatTime } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'

/**
 * 右栏的合集。
 *
 * B 站观看页把合集放在相关推荐上面：标题带集数，每集一行可点。
 * 这里点一集直接换过去，返回时仍然回到进来的那一页（用 replace 不压栈）。
 */
export function SeasonList({ season }: { season: SeasonView }) {
  const replace = useAppStore((s) => s.replace)
  const currentRef = useRef<HTMLLIElement | null>(null)

  // 10 集以上的合集一屏放不下，不滚的话用户看不出自己正在第几集。
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [season.id])

  return (
    <div className="border-b border-hairline px-3 py-2">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="min-w-0 truncate text-[13px] font-medium text-[var(--text-1)]" title={season.title}>
          {season.title}
        </h3>
        <span className="num shrink-0 text-[11px] text-[var(--text-3)]">{season.episodes.length} 集</span>
      </div>
      <ol className="flex max-h-[320px] flex-col gap-y-1.5 overflow-y-auto">
        {season.episodes.map((ep, index) => (
          <li key={ep.key} ref={ep.current ? currentRef : undefined}>
            <button
              type="button"
              disabled={ep.current}
              onClick={() =>
                replace({
                  kind: 'watch',
                  track: {
                    key: ep.key,
                    title: ep.title,
                    artist: '',
                    duration_ms: ep.duration_ms || null,
                    cover: ep.cover,
                    views: ep.views,
                  },
                })
              }
              title={ep.title}
              className={`group flex w-full items-start gap-2 rounded-[4px] px-1 py-1 text-left ${
                ep.current ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-alt)]'
              }`}
            >
              <span className="num w-4 shrink-0 pt-0.5 text-right text-[11px] text-[var(--text-3)]">
                {index + 1}
              </span>
              <span className="relative w-[88px] shrink-0 overflow-hidden rounded-[3px]" style={{ aspectRatio: '16 / 10' }}>
                <Cover cover={ep.cover} title={ep.title} width={88} className="h-full w-full" />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`line-clamp-2 text-[12px] leading-[1.35] ${
                    ep.current ? 'text-[var(--accent)]' : 'text-[var(--text-1)] group-hover:text-[var(--accent)]'
                  }`}
                >
                  {ep.title}
                </span>
                <span className="num mt-0.5 block truncate text-[11px] text-[var(--text-3)]">
                  {ep.duration_ms ? formatTime(ep.duration_ms) : ''}
                  {ep.views ? ` · ${formatCount(ep.views)}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
