import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { useAutoplay } from './autoplay'

/** 观看页右栏：相关推荐。条目全来自接口，点击进入它自己的观看页。 */
export function RelatedAside({ items }: { items: Track[] }) {
  const replace = useAppStore((s) => s.replace)
  const autoplay = useAutoplay((s) => s.enabled)
  const setAutoplay = useAutoplay((s) => s.setEnabled)
  if (items.length === 0) return null

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[12px] text-[var(--text-3)]">相关推荐</h3>
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
      <div className="flex flex-col gap-y-2">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => replace({ kind: 'watch', track: item })}
            title={item.title}
            className="group flex items-start gap-2 text-left"
          >
            <span
              className="relative w-[136px] shrink-0 overflow-hidden rounded-[4px]"
              style={{ aspectRatio: '16 / 10' }}
            >
              <Cover cover={item.cover} title={item.title} width={136} className="h-full w-full" />
              {/* B 站相关推荐的封面右下角挂着时长，扫一眼就知道要花多久。 */}
              {item.duration_ms ? (
                <span className="num absolute bottom-0.5 right-1 rounded-[2px] bg-black/65 px-1 text-[10px] leading-[14px] text-white">
                  {formatDuration(item.duration_ms)}
                </span>
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] leading-[1.4] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                {item.title}
              </span>
              <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-3)]">
                <span className="truncate">{item.artist}</span>
                {/* B 站这一行的两枚计数用「播放 / 弹幕」两条小图标，不用文字写「播放」。 */}
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
    </div>
  )
}
