import { useState } from 'react'
import { Slider } from '../../shared/ui/Slider'
import { Icon } from '../../shared/ui/Icon'
import { usePlayerStore } from './playerStore'

export function VolumeControl() {
  const volume = usePlayerStore((state) => state.snapshot?.volume ?? 0.7)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? volume

  return (
    <div className="flex items-center gap-2 text-[var(--text-2)]">
      <button
        type="button"
        aria-label={shown > 0 ? '静音' : '取消静音'}
        title={shown > 0 ? '静音' : '取消静音'}
        onClick={() => void setVolume(shown > 0 ? 0 : 0.7)}
        className="t press flex items-center justify-center rounded-[4px] h-6 w-6 hover:text-[var(--text-1)]"
      >
        <Icon name={shown > 0 ? 'volume' : 'mute'} size={16} />
      </button>
      <div className="w-[84px]">
        <Slider
          value={shown}
          label="音量"
          step={0.05}
          size="sm"
          onChange={setDraft}
          onCommit={(value) => {
            setDraft(null)
            void setVolume(value)
          }}
        />
      </div>
    </div>
  )
}
