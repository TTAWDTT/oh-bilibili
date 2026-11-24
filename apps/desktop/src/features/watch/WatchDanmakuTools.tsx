import { useState } from 'react'
import { Icon } from '../../shared/ui/Icon'
import { AnchoredPanel, type Anchor } from '../../shared/ui/AnchoredPanel'
import { BiliDanmakuSwitch } from '../../shared/ui/BiliDanmakuIcons'
import { useDanmakuSettings } from '../player/danmakuSettings'

/** 发弹幕可选的颜色，取 B 站播放器那排常用色。 */
const DANMAKU_COLORS: { name: string; value: number }[] = [
  { name: '白', value: 0xffffff },
  { name: '红', value: 0xfe0302 },
  { name: '橙', value: 0xff9104 },
  { name: '黄', value: 0xffd302 },
  { name: '绿', value: 0x00cd00 },
  { name: '蓝', value: 0x00a1d6 },
  { name: '紫', value: 0xa020f0 },
  { name: '黑', value: 0x000000 },
]

/** 弹幕位置：B 站的 mode 参数。 */
const DANMAKU_MODES: { name: string; value: number }[] = [
  { name: '滚动', value: 1 },
  { name: '顶部', value: 5 },
  { name: '底部', value: 4 },
]

/** 弹幕可出现的画面高度，和 B 站播放器一样分三档。 */
const DANMAKU_AREAS = [
  { name: '1/4', value: 0.25 },
  { name: '1/2', value: 0.5 },
  { name: '全屏', value: 1 },
] as const

export function WatchDanmakuTools({ cinema, open, onToggle, onClose, draftMode, setDraftMode }: {
  cinema: boolean
  open: boolean
  onToggle: (button: HTMLButtonElement) => void
  onClose: () => void
  draftMode: number
  setDraftMode: (mode: number) => void
}) {
  const {
    enabled, setEnabled, opacity, size, speed, area, patch,
    blockTypes, toggleBlockType, blockWords, setBlockWords,
    mergeSame, setMergeSame, sendColor, setSendColor,
  } = useDanmakuSettings()
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [blockDraft, setBlockDraft] = useState('')

  const addBlockWords = (): void => {
    const words = blockDraft
      .split(/[\s,，]+/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean)
    if (words.length === 0) return
    setBlockWords([...new Set([...blockWords, ...words])])
    setBlockDraft('')
  }

  return (
    <div className="watch-dm-tools" data-cinema={cinema}>
      <button
        type="button"
        className="watch-dm-toggle"
        aria-pressed={enabled}
        aria-label={enabled ? '关闭弹幕' : '打开弹幕'}
        title={enabled ? '关闭弹幕（D）' : '打开弹幕（D）'}
        onClick={() => setEnabled(!enabled)}
      >
        {cinema ? <BiliDanmakuSwitch size={21} on={enabled} /> : (
          <>
            弹幕
            <span className="watch-dm-indicator" aria-hidden />
          </>
        )}
      </button>
      <div className="relative" data-watch-menu>
        <button
          type="button"
          aria-expanded={open}
          aria-label="弹幕设置"
          title="弹幕设置"
          className="watch-dm-settings"
          onClick={(event) => {
            const trigger = event.currentTarget
            const rect = trigger.getBoundingClientRect()
            setAnchor({
              trigger,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 278)),
              top: rect.bottom + 6,
              anchorTop: rect.top,
            })
            onToggle(trigger)
          }}
        >
          <Icon name="settings" size={19} />
        </button>
        <AnchoredPanel anchor={open ? anchor : null} label="弹幕设置" width={270} onClose={onClose}>
          <div className="watch-dm-panel">
            <div className="watch-dm-title">
              <span>弹幕设置</span>
              <button type="button" aria-label="关闭弹幕设置" title="关闭" onClick={() => {
                onClose()
                anchor?.trigger?.focus({ preventScroll: true })
              }}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="flex items-center justify-between text-[12px] leading-none text-[var(--dm-secondary)]">
              <span>显示区域</span>
              <span>{DANMAKU_AREAS.find((option) => option.value === area)?.name}</span>
            </div>
            <div className="mt-1.5 flex gap-1">
              {DANMAKU_AREAS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={area === option.value}
                  onClick={() => patch({ area: option.value })}
                  className={`t press flex-1 rounded-[3px] py-1.5 text-[12px] leading-none ${
                    area === option.value
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--dm-fill)] text-[var(--dm-secondary)] hover:bg-[var(--dm-hover)]'
                  }`}
                >
                  {option.name}
                </button>
              ))}
            </div>
            {(
              [
                { key: 'opacity', label: '不透明度', min: 0.2, max: 1, step: 0.1, value: opacity },
                { key: 'size', label: '字号', min: 11, max: 20, step: 1, value: size },
                { key: 'speed', label: '速度', min: 0.6, max: 2, step: 0.2, value: speed },
              ] as const
            ).map((row) => (
              <label key={row.key} className="block border-t border-[var(--dm-line)] pt-2">
                <span className="flex items-center justify-between text-[12px] leading-none text-[var(--dm-secondary)]">
                  <span>{row.label}</span>
                  <span className="num">{row.key === 'opacity' ? `${Math.round(row.value * 100)}%` : row.value}</span>
                </span>
                <input
                  type="range"
                  min={row.min}
                  max={row.max}
                  step={row.step}
                  value={row.value}
                  onChange={(event) => patch({ [row.key]: Number(event.target.value) })}
                  className="bili-range mt-1 w-full"
                />
              </label>
            ))}

            <div className="border-t border-[var(--dm-line)] pt-2">
              <div className="flex items-center justify-between text-[12px] leading-none text-[var(--dm-secondary)]">
                <span>屏蔽类型</span>
              </div>
              <div className="mt-1.5 flex gap-1">
                {(
                  [
                    { value: 'roll', name: '滚动' },
                    { value: 'top', name: '顶部' },
                    { value: 'bottom', name: '底部' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={blockTypes.includes(option.value)}
                    onClick={() => toggleBlockType(option.value)}
                    className={`t press flex-1 rounded-[4px] py-1.5 text-[12px] leading-none ${
                      blockTypes.includes(option.value)
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--dm-fill)] text-[var(--dm-secondary)] hover:bg-[var(--dm-hover)]'
                    }`}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mergeSame}
                onClick={() => setMergeSame(!mergeSame)}
                className="mt-2 flex w-full items-center justify-between border-t border-[var(--dm-line)] pt-2 text-[12px] leading-none text-[var(--dm-secondary)] hover:text-[var(--dm-text)]"
              >
                合并同句
                <span
                  className={`relative flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
                    mergeSame ? 'bg-[var(--accent)]' : 'bg-[var(--dm-hover)]'
                  }`}
                >
                  <span
                    className={`h-3 w-3 rounded-full bg-white transition-transform ${
                      mergeSame ? 'translate-x-3' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>
            </div>

            <div className="border-t border-[var(--dm-line)] pt-2">
              <div className="flex items-center justify-between text-[12px] leading-none text-[var(--dm-secondary)]">
                <span>屏蔽词</span>
                {blockWords.length > 0 ? (
                  <span className="num">{blockWords.length} 个</span>
                ) : null}
              </div>
              <div className="mt-1.5 flex gap-1">
                <input
                  value={blockDraft}
                  onChange={(event) => setBlockDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addBlockWords()
                    }
                  }}
                  placeholder="输入后回车"
                  className="h-6 min-w-0 flex-1 rounded-[3px] border border-[var(--dm-line)] bg-[var(--dm-fill)] px-1.5 text-[12px] text-[var(--dm-text)] placeholder:text-[var(--dm-secondary)] outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={addBlockWords}
                  className="t press h-6 rounded-[3px] bg-[var(--dm-fill)] px-2 text-[12px] text-[var(--dm-secondary)] hover:bg-[var(--dm-hover)]"
                >
                  加
                </button>
              </div>
              {blockWords.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {blockWords.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() =>
                        setBlockWords(blockWords.filter((item) => item !== word))
                      }
                      className="t press rounded-[3px] bg-[var(--dm-fill)] px-1.5 py-0.5 text-[10px] text-[var(--dm-secondary)] hover:bg-[var(--dm-hover)]"
                    >
                      {word} ×
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="border-t border-[var(--dm-line)] pt-2">
              <div className="flex items-center justify-between text-[12px] leading-none text-[var(--dm-secondary)]">
                <span>弹幕颜色</span>
                <span>{DANMAKU_COLORS.find((color) => color.value === sendColor)?.name}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-8 gap-1.5">
                {DANMAKU_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={`弹幕颜色 ${color.name}`}
                    aria-pressed={sendColor === color.value}
                    onClick={() => setSendColor(color.value)}
                    className={`h-4 w-4 rounded-full border ${
                      sendColor === color.value ? 'border-[var(--dm-text)] ring-1 ring-[var(--dm-text)]' : 'border-[var(--dm-line)]'
                    }`}
                    style={{ background: '#' + color.value.toString(16).padStart(6, '0') }}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--dm-line)] pt-2">
              <div className="flex items-center justify-between text-[12px] leading-none text-[var(--dm-secondary)]">
                <span>位置</span>
                <span>{DANMAKU_MODES.find((mode) => mode.value === draftMode)?.name}</span>
              </div>
              <div className="mt-1.5 flex gap-1">
                {DANMAKU_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    aria-pressed={draftMode === mode.value}
                    onClick={() => setDraftMode(mode.value)}
                    className={`t press flex-1 rounded-[4px] py-1.5 text-[12px] leading-none ${
                      draftMode === mode.value
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--dm-fill)] text-[var(--dm-secondary)] hover:bg-[var(--dm-hover)]'
                    }`}
                  >
                    {mode.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </AnchoredPanel>
      </div>
    </div>
  )
}
