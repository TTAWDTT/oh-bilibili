import { useState } from 'react'
import { AnchoredPanel, type Anchor } from '../../shared/ui/AnchoredPanel'
import { BiliDanmakuSetting, BiliDanmakuSwitch } from '../../shared/ui/BiliDanmakuIcons'
import { useDanmakuSettings } from './danmakuSettings'

export function DanmakuPanel() {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const { enabled, opacity, size, speed, mergeSame, setEnabled, patch, setMergeSame } =
    useDanmakuSettings()

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--panel)]/75 px-1 text-[var(--text-2)]">
      <button
        type="button"
        aria-label={enabled ? '关闭弹幕' : '打开弹幕'}
        aria-pressed={enabled}
        title={enabled ? '关闭弹幕' : '打开弹幕'}
        onClick={() => setEnabled(!enabled)}
        className="t press flex h-8 items-center gap-1 rounded-full px-2 text-[13px] hover:bg-[var(--hover)] aria-pressed:text-[var(--accent-strong)]"
      >
        <BiliDanmakuSwitch on={enabled} size={18} />
        弹幕
      </button>
      <button
        type="button"
        aria-label="弹幕设置"
        aria-haspopup="dialog"
        title="弹幕设置"
        onClick={(event) => {
          if (anchor) { setAnchor(null); return }
          const trigger = event.currentTarget
          const rect = trigger.getBoundingClientRect()
          setAnchor({ trigger, left: Math.max(8, rect.right - 224), top: rect.bottom + 6, anchorTop: rect.top })
        }}
        aria-expanded={anchor !== null}
        className="t press flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--hover)] aria-expanded:text-[var(--accent-strong)]"
      >
        <BiliDanmakuSetting size={18} />
      </button>
      <AnchoredPanel anchor={anchor} onClose={() => setAnchor(null)} label="弹幕设置" width={224}>
        <div className="px-3 pb-3">
          <Slider label="透明度" min={0.2} max={1} step={0.1} value={opacity} onChange={(v) => patch({ opacity: v })} />
          <Slider label="字号" min={11} max={22} step={1} value={size} onChange={(v) => patch({ size: v })} />
          <Slider label="速度" min={0.5} max={2.5} step={0.1} value={speed} onChange={(v) => patch({ speed: v })} />

          <label className="mt-3 flex items-center justify-between text-[14px]">
            合并同句
            <input
              type="checkbox"
              checked={mergeSame}
              onChange={(e) => setMergeSame(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
          </label>
        </div>
      </AnchoredPanel>
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
    <label className="mt-3 block text-[13px] text-[var(--text-2)]">
      <span className="flex items-center justify-between">
        {label}
        <span className="num text-[var(--text-3)]">{value.toFixed(1)}</span>
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
