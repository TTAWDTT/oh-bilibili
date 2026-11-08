import type { ReactNode } from 'react'
import { usePlayerStore } from './playerStore'
import { Icon } from '../../shared/ui/Icon'

function TransportButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={[
        't press flex h-8 w-8 items-center justify-center rounded-[4px]',
        active ? 'text-[var(--accent)]' : 'text-white/70 hover:text-white',
        disabled ? 'cursor-default opacity-30' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function Transport() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const toggle = usePlayerStore((state) => state.toggle)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat)
  const setShuffle = usePlayerStore((state) => state.setShuffle)

  const hasTrack = snapshot?.track != null
  const playing = snapshot?.phase === 'playing'
  const loading = snapshot?.phase === 'loading'
  const repeat = snapshot?.repeat ?? 'off'
  const shuffle = snapshot?.shuffle ?? false

  return (
    <div className="flex items-center gap-2">
      <TransportButton label={shuffle ? '关闭随机播放' : '随机播放'} active={shuffle} onClick={() => setShuffle(!shuffle)}>
        <Icon name="shuffle" size={16} />
      </TransportButton>
      <TransportButton label="上一首" disabled={!hasTrack} onClick={() => void prev()}>
        <Icon name="prev" size={18} />
      </TransportButton>
      <button
        type="button"
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停（空格）' : '播放（空格）'}
        disabled={!hasTrack}
        onClick={() => void toggle()}
        className={[
          't press mx-1 flex h-10 w-10 items-center justify-center rounded-full',
          hasTrack
            ? 'bg-white text-black active:scale-[0.96]'
            : 'cursor-default border border-white/32 bg-white/[0.04] text-white/48',
        ].join(' ')}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/15 border-t-black" />
        ) : (
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        )}
      </button>
      <TransportButton label="下一首" disabled={!hasTrack} onClick={() => void next()}>
        <Icon name="next" size={18} />
      </TransportButton>
      <TransportButton
        label={repeat === 'off' ? '循环：关' : repeat === 'all' ? '循环：列表' : '循环：单曲'}
        active={repeat !== 'off'}
        onClick={() => void cycleRepeat()}
      >
        <Icon name={repeat === 'one' ? 'repeatOne' : 'repeat'} size={16} />
      </TransportButton>
    </div>
  )
}
