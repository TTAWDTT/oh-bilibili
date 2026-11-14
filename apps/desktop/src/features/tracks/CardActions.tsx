import type React from 'react'
import { DownloadButton } from '../downloads/DownloadButton'
import { useReactionStore } from '../reactions/reactionStore'
import { Icon } from '../../shared/ui/Icon'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'
import type { Track } from '../../shared/lib/contract'

/**
 * 卡片封面上的动作排：听、赞、投币、收藏、稍后再看、下载。
 *
 * 这一条压在封面图上的黑色渐变里，所以用白字；正文区的浅色规则不适用于它。
 * 常驻会把卡片的正文撑成六行，所以只在 hover 时出现。
 */
export function CardActions({
  track,
  onListen,
  onCoin,
  onFav,
  onLater,
  extraAction,
}: {
  track: Track
  onListen: () => void
  onCoin: () => void
  onFav: (faved: boolean) => void
  onLater: () => void
  extraAction?: React.ReactNode
}) {
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const toggleLike = useReactionStore((st) => st.toggleLike)
  const hydrate = useReactionStore((st) => st.hydrate)

  const item =
    'bili-icon-btn flex h-6 w-6 items-center justify-center rounded-[4px] hover:bg-white/20'
  const off = 'text-white/90 hover:text-white'

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-end gap-0.5 rounded-t-[8px] bg-gradient-to-b from-black/75 via-black/40 to-transparent px-1.5 pb-4 pt-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
      // 互动状态只在这排动作真正被用到时查。整页/预取时逐条查 relation，
      // 会把串行闸门占满，翻页反而被拖慢。
      onPointerEnter={() => void hydrate([track.key]).catch(() => {})}
    >
      <button type="button" aria-label={`听 ${track.title}`} title="只听声音" onClick={onListen} className={`${item} ${off}`}>
        <Icon name="headphones" size={13} />
      </button>
      <button
        type="button"
        aria-label={liked ? '取消点赞' : '点赞'}
        aria-pressed={liked}
        title={liked ? '取消点赞' : '点赞'}
        onClick={() => void toggleLike(track)}
        className={`${item} ${liked ? 'text-[var(--accent)]' : off}`}
      >
        <span key={liked ? 'on' : 'off'} className={liked ? 'bili-tri-pop' : undefined}>
          <BiliThumb size={13} filled={liked} />
        </span>
      </button>
      <button
        type="button"
        aria-label={coins > 0 ? `已投 ${coins} 枚币` : '投币'}
        title={coins >= 2 ? '已经投满 2 枚' : '投币'}
        disabled={coins >= 2}
        onClick={onCoin}
        className={`${item} ${coins > 0 ? 'text-[var(--coin)]' : off} ${coins >= 2 ? 'cursor-default opacity-50' : ''}`}
      >
        <span key={coins} className={coins > 0 ? 'bili-tri-flip' : undefined}>
          <BiliCoin size={13} />
        </span>
      </button>
      <button
        type="button"
        aria-label={faved ? '取消收藏' : '收藏'}
        aria-pressed={faved}
        title={faved ? '取消收藏' : '收藏'}
        onClick={() => onFav(faved)}
        className={`${item} ${faved ? 'text-[var(--coin)]' : off}`}
      >
        <span key={faved ? 'on' : 'off'} className={faved ? 'bili-tri-spin' : undefined}>
          <BiliStar size={13} filled={faved} />
        </span>
      </button>
      <button type="button" aria-label="稍后再看" title="稍后再看" onClick={onLater} className={`${item} ${off}`}>
        <Icon name="watchLater" size={13} />
      </button>
      <DownloadButton trackKey={track.key} size={13} />
      {extraAction}
    </div>
  )
}
