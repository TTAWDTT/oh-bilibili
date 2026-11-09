import { useState } from 'react'
import { Icon } from '../../shared/ui/Icon'
import { useDanmakuSettings } from './danmakuSettings'

/** 弹幕设置面板。四项，和 B 站播放器的面板一致。 */
export function DanmakuPanel() {
  const [open, setOpen] = useState(false)
  const { enabled, opacity, size, speed, setEnabled, patch } = useDanmakuSettings()

  return (
    <div className="absolute right-5 top-16 z-20">
      <button
        type="button"
        aria-label="弹幕设置"
        title="弹幕设置"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={[
          't press flex h-8 w-8 items-center justify-center rounded-[4px]',
          open ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-3)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]',
        ].join(' ')}
      >
        <Icon name="settings" size={15} />
      </button>

      {open ? (
        <div className="mt-2 w-56 rounded-[6px] border border-white/15 bg-black/75 p-3 text-white backdrop-blur">
          <label className="flex items-center justify-between text-[14px]">
            显示弹幕
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
          </label>

          <Slider label="透明度" min={0.2} max={1} step={0.1} value={opacity} onChange={(v) => patch({ opacity: v })} />
          <Slider label="字号" min={11} max={22} step={1} value={size} onChange={(v) => patch({ size: v })} />
          <Slider label="速度" min={0.5} max={2.5} step={0.1} value={speed} onChange={(v) => patch({ speed: v })} />
        </div>
      ) : null}
    </div>
  )
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="mt-3 block text-[13px] text-white/70">
      <span className="flex items-center justify-between">
        {label}
        <span className="num text-white/45">{value.toFixed(1)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--accent)]"
      />
    </label>
  )
}
