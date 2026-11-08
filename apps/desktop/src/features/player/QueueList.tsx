import { formatDuration } from '../../shared/lib/format'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Equalizer } from '../../shared/ui/Equalizer'
import { Skeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from './playerStore'

export function QueueList() {
  const queue = usePlayerStore((state) => state.queue)
  const playContext = usePlayerStore((state) => state.playContext)

  if (!queue) {
    return (
      <div className="space-y-3 px-5 py-5" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (queue.items.length === 0) {
    return (
      <EmptyState
        icon="queue"
        title="队列是空的"
        detail="播放任意一首歌后，这里会显示接下来的顺序。"
        action={null}
        compact
      />
    )
  }

  const keys = queue.items.map((track) => track.key)

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-2 pt-4 text-[10px] tracking-[0.14em] text-white/24">
        接下来 · {queue.items.length} 首
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {queue.items.map((track, index) => {
          const active = queue.index === index
          return (
            <button
              key={`${track.key}-${index}`}
              type="button"
              onClick={() => void playContext(keys, index)}
              className={[
                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition duration-200',
                active ? 'bg-white/8' : 'hover:bg-white/[0.05]',
              ].join(' ')}
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                {active ? (
                  <Equalizer size="sm" />
                ) : (
                  <span className="font-mono text-[10px] text-white/24">{index + 1}</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={[
                    'block truncate text-[12.5px]',
                    active ? 'text-[var(--accent)]' : 'text-white/74',
                  ].join(' ')}
                >
                  {track.title}
                </span>
                <span className="block truncate text-[10.5px] text-white/32">{track.artist}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-white/24">{formatDuration(track.duration_ms)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
