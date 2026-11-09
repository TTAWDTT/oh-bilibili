import * as ipc from '../../shared/lib/ipc'
import { Icon } from '../../shared/ui/Icon'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { formatDuration } from '../../shared/lib/format'
import type { Track } from '../../shared/lib/contract'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Equalizer } from '../../shared/ui/Equalizer'
import { Skeleton } from '../../shared/ui/Skeleton'
import { VirtualList } from '../../shared/ui/VirtualList'
import { usePlayerStore } from './playerStore'

// 虚拟列表要求固定行高，所以这个值就是行的实际高度。
// 40px 装两行字（14px 标题 + 12px 副行）只剩 2px 留白，读起来很挤；
// 60px 给每边约 9px，接近 B 站列表的节奏。
const QUEUE_ROW_HEIGHT = 60
const VIRTUAL_THRESHOLD = 100

function QueueRow({
  track,
  index,
  active,
  onPlay,
  onMove,
  onRemove,
}: {
  track: Track
  index: number
  active: boolean
  onPlay: () => void
  onMove: (from: string, to: string) => void
  onRemove: (key: string) => void
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-current={active ? 'true' : undefined}
      style={{ height: QUEUE_ROW_HEIGHT }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', track.key)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        event.preventDefault()
        const from = event.dataTransfer.getData('text/plain')
        if (from && from !== track.key) onMove(from, track.key)
      }}
      className="t group flex w-full items-center gap-2.5 border-b border-hairline px-4 py-2.5 text-left"
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {active ? (
          <Equalizer size="sm" />
        ) : (
          <>
            <span className="num font-mono text-[12px] text-[var(--text-2)] group-hover:hidden">{index + 1}</span>
            <span className="hidden cursor-grab text-[var(--text-3)] group-hover:block" aria-hidden>
              <Icon name="grip" size={12} />
            </span>
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={['block truncate text-[14px] leading-[1.5]', active ? 'text-[var(--accent)]' : 'text-[var(--text-2)] group-hover:text-[var(--text-1)]'].join(' ')}
          title={track.title}
        >
          {track.title}
        </span>
        <span className="mt-[3px] block truncate text-[12px] leading-[1.45] text-[var(--text-2)] group-hover:text-[var(--text-2)]" title={track.artist}>
          {track.artist}
        </span>
      </span>
      <span className="num shrink-0 font-mono text-[12px] text-[var(--text-2)]">{formatDuration(track.duration_ms)}</span>
      <span
        role="button"
        tabIndex={-1}
        aria-label={`从队列移除 ${track.title}`}
        title="从队列移除"
        onClick={(event) => {
          event.stopPropagation()
          onRemove(track.key)
        }}
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-[var(--text-3)] opacity-0 transition-opacity hover:bg-[var(--hover)] hover:text-[var(--text-1)] group-hover:opacity-100"
      >
        <Icon name="close" size={11} />
      </span>
    </button>
  )
}

export function QueueList() {
  const queue = usePlayerStore((state) => state.queue)
  const playContext = usePlayerStore((state) => state.playContext)
  const moveInQueue = usePlayerStore((state) => state.moveInQueue)
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue)
  const clearQueue = usePlayerStore((state) => state.clearQueue)
  const [restore, setRestore] = useState<[number, number] | null>(null)

  // 队列在后台补齐时每两秒问一次进度，补完就停。
  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      try {
        const p = await ipc.queueRestoreProgress()
        if (!alive) return
        setRestore(p)
        if (p) window.setTimeout(() => void tick(), 2000)
      } catch {
        // 拿不到就不显示，不值得打断
      }
    }
    void tick()
    return () => {
      alive = false
    }
  }, [])
  const navigate = useAppStore((state) => state.navigate)

  if (!queue) {
    return (
      <div aria-hidden>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-[60px] items-center gap-2.5 border-b border-hairline px-4">
            <Skeleton className="h-2.5 w-3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (queue.items.length === 0) {
    return (
      <EmptyState
        icon="biliTv"
        title="前方高能，队列还是空的"
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
      onMove={(from, to) => void moveInQueue(from, to)}
      onRemove={(key) => void removeFromQueue(key)}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-5 pb-2 pt-4 text-[12px] tracking-[0.14em] text-[var(--text-2)]">
        <span className="flex items-center gap-2">
          接下来 · {queue.items.length} 首
          <button
            type="button"
            onClick={() => void clearQueue()}
            title="清空队列"
            className="text-[11px] text-[var(--text-3)] hover:text-[var(--bili-pink)]"
          >
            清空
          </button>
        </span>
        {restore ? (
          <span className="num text-[var(--accent)]">
            恢复中 {restore[0]}/{restore[1]}
          </span>
        ) : null}
      </div>
      {queue.items.length > VIRTUAL_THRESHOLD ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <VirtualList items={queue.items} rowHeight={QUEUE_ROW_HEIGHT} renderRow={rows} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
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
