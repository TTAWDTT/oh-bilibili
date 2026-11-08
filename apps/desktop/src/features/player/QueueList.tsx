import { useAppStore } from '../../app/appStore'
import { formatDuration } from '../../shared/lib/format'
import type { Track } from '../../shared/lib/contract'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Equalizer } from '../../shared/ui/Equalizer'
import { Skeleton } from '../../shared/ui/Skeleton'
import { VirtualList } from '../../shared/ui/VirtualList'
import { usePlayerStore } from './playerStore'

const QUEUE_ROW_HEIGHT = 48
const VIRTUAL_THRESHOLD = 100

function QueueRow({
  track,
  index,
  active,
  onPlay,
}: {
  track: Track
  index: number
  active: boolean
  onPlay: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-current={active ? 'true' : undefined}
      style={{ height: QUEUE_ROW_HEIGHT }}
      className={[
        't press flex w-full items-center gap-3 rounded-xl px-3 text-left',
        active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]',
      ].join(' ')}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {active ? <Equalizer size="sm" /> : <span className="num font-mono text-[10px] text-white/28">{index + 1}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={['block truncate text-[12.5px]', active ? 'text-[var(--accent)]' : 'text-white/78'].join(' ')}
          title={track.title}
        >
          {track.title}
        </span>
        <span className="mt-1 block truncate text-[10.5px] text-white/36" title={track.artist}>
          {track.artist}
        </span>
      </span>
      <span className="num shrink-0 font-mono text-[10px] text-white/28">{formatDuration(track.duration_ms)}</span>
    </button>
  )
}

export function QueueList() {
  const queue = usePlayerStore((state) => state.queue)
  const playContext = usePlayerStore((state) => state.playContext)
  const navigate = useAppStore((state) => state.navigate)

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
        detail="挑一首歌开始播放，接下来的顺序会出现在这里。"
        action={{ label: '去搜索', onClick: () => navigate({ kind: 'search' }) }}
        compact
      />
    )
  }

  const keys = queue.items.map((track) => track.key)
  const rows = (track: Track, index: number) => (
    <QueueRow
      track={track}
      index={index}
      active={queue.index === index}
      onPlay={() => void playContext(keys, index)}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 pb-2 pt-4 text-[10px] tracking-[0.14em] text-white/28">
        接下来 · {queue.items.length} 首
      </div>
      {queue.items.length > VIRTUAL_THRESHOLD ? (
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-4">
          <VirtualList items={queue.items} rowHeight={QUEUE_ROW_HEIGHT} renderRow={rows} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {queue.items.map((track, index) => (
            <div key={`${track.key}-${index}`} style={{ height: QUEUE_ROW_HEIGHT }}>
              {rows(track, index)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
