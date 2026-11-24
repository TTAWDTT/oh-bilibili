import { useState } from 'react'
import { Slider } from '../../shared/ui/Slider'
import { Icon } from '../../shared/ui/Icon'
import { usePlayerStore } from './playerStore'

export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const volume = usePlayerStore((state) => state.snapshot?.volume ?? 0.7)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? volume

  return (
    <div className={`group/vol flex items-center text-[var(--text-2)] ${compact ? 'group' : 'gap-2'}`}>
      <button
        type="button"
        aria-label={shown > 0 ? '静音' : '取消静音'}
        title={shown > 0 ? '静音' : '取消静音'}
        onClick={() => void setVolume(shown > 0 ? 0 : 0.7)}
        className={`t press flex items-center justify-center rounded-[4px] hover:text-[var(--text-1)] ${
          compact ? 'h-7 w-7' : 'h-6 w-6'
        }`}
      >
        <Icon name={shown > 0 ? 'volume' : 'mute'} size={16} />
      </button>
      <div
        className={
          compact
            ? 'w-0 overflow-hidden transition-[width] duration-150 group-hover/vol:w-[84px] group-focus-within/vol:w-[84px]'
            : 'w-[84px]'
        }
      >
        <Slider
          value={shown}
          label="音量"
          step={0.05}
          size="sm"
          insetThumb={compact}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onCommit={(value) => {
            setDraft(null)
            void setVolume(value)
          }}
          ariaValueText={`${Math.round(shown * 100)}%`}
        />
      </div>
    </div>
  )
}
