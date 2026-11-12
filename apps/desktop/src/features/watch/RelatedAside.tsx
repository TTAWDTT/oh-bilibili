import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { formatCount } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'

/** 观看页右栏：相关推荐。条目全来自接口，点击进入它自己的观看页。 */
export function RelatedAside({ items }: { items: Track[] }) {
  const navigate = useAppStore((s) => s.navigate)
  if (items.length === 0) return null

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-[12px] text-[var(--text-3)]">相关推荐</h3>
        <span className="num text-[11px] text-[var(--text-3)]">{items.length} 条</span>
      </div>
      <div className="flex flex-col gap-y-2">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate({ kind: 'watch', track: item })}
            title={item.title}
            className="group flex items-start gap-2 text-left"
          >
            <span
              className="relative w-[136px] shrink-0 overflow-hidden rounded-[4px]"
              style={{ aspectRatio: '16 / 10' }}
            >
              <Cover cover={item.cover} title={item.title} className="h-full w-full" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] leading-[1.4] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                {item.title}
              </span>
              <span className="num mt-1 block truncate text-[12px] text-[var(--text-3)]">
                {item.artist}
                {item.views ? ` · ${formatCount(item.views)}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
