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
    <div className={`flex items-center gap-0.5 ${className ?? ''}`}>
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
          'rounded-full p-1.5 transition duration-200',
          liked ? 'text-[var(--accent)]' : 'text-white/34 hover:bg-white/8 hover:text-white/80',
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
          'rounded-full p-1.5 transition duration-200',
          faved ? 'text-[#ffc46b]' : 'text-white/34 hover:bg-white/8 hover:text-white/80',
        ].join(' ')}
      >
        <Icon name={faved ? 'bookmarkFilled' : 'bookmark'} size={size} />
      </button>
    </div>
  )
}
