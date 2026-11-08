import type { Track } from '../lib/contract'
import { useReactionStore } from '../../features/reactions/reactionStore'
import { Icon } from './Icon'

type ReactionButtonsProps = {
  track: Track
  size?: number
  className?: string
}

export function ReactionButtons({ track, size = 16, className }: ReactionButtonsProps) {
  const liked = useReactionStore((state) => state.liked[track.key] ?? false)
  const faved = useReactionStore((state) => state.faved[track.key] ?? false)
  const toggleLike = useReactionStore((state) => state.toggleLike)
  const toggleFav = useReactionStore((state) => state.toggleFav)

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <button
        type="button"
        aria-pressed={liked}
        aria-label={liked ? '取消喜欢' : '喜欢'}
        title={liked ? '取消喜欢' : '喜欢'}
        onClick={(event) => {
          event.stopPropagation()
          void toggleLike(track)
        }}
        className={[
          't press flex h-6 w-6 items-center justify-center rounded-[4px]',
          liked ? 'text-[var(--accent)]' : 'text-[var(--text-2)] hover:text-white',
        ].join(' ')}
      >
        <Icon name={liked ? 'heartFilled' : 'heart'} size={size} />
      </button>
      <button
        type="button"
        aria-pressed={faved}
        aria-label={faved ? '取消收藏' : '收藏'}
        title={faved ? '取消收藏' : '收藏'}
        onClick={(event) => {
          event.stopPropagation()
          void toggleFav(track)
        }}
        className={[
          't press flex h-6 w-6 items-center justify-center rounded-[4px]',
          faved ? 'text-[#ffc46b]' : 'text-[var(--text-2)] hover:text-white',
        ].join(' ')}
      >
        <Icon name={faved ? 'bookmarkFilled' : 'bookmark'} size={size} />
      </button>
    </div>
  )
}
