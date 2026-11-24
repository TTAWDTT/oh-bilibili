import { useState } from 'react'
import { Slider } from '../../shared/ui/Slider'
import { Icon } from '../../shared/ui/Icon'
import { usePlayerStore } from './playerStore'
import './volume-control.css'

export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const volume = usePlayerStore((state) => state.snapshot?.volume ?? 0.7)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const [draft, setDraft] = useState<number | null>(null)
  const [pointerOver, setPointerOver] = useState(false)
  const shown = draft ?? volume
  const percentage = `${Math.round(shown * 100)}%`

  return (
    <div
      className={`flex items-center text-[var(--text-2)] ${compact ? 'volume-compact relative' : 'gap-2'}`}
      data-open={compact && (pointerOver || draft !== null) ? true : undefined}
      onPointerEnter={compact ? () => setPointerOver(true) : undefined}
      onPointerLeave={compact ? () => setPointerOver(false) : undefined}
      onPointerUp={compact ? (event) => {
        // WebKit 拖出滑杆再松手时，可能要等鼠标再次移动才更新 :hover。
        setPointerOver(event.currentTarget.contains(document.elementFromPoint(event.clientX, event.clientY)))
      } : undefined}
    >
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
      <div data-volume-panel={compact ? '' : undefined} className={compact ? undefined : 'w-[84px]'}>
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
          ariaValueText={percentage}
        />
        {compact && <span data-volume-value aria-hidden="true">{percentage}</span>}
      </div>
    </div>
  )
}
