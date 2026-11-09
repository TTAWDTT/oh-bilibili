/**
 * 时长筛选。B 站搜索页那一行「时长：全部 / 10分钟以下 / 10-30分钟 / 30-60分钟 / 60分钟以上」。
 *
 * 对应接口的 duration 参数：1 / 2 / 3 / 4，空表示不限。
 */
export type DurationKey = 0 | 1 | 2 | 3 | 4

const OPTIONS: { key: DurationKey; label: string }[] = [
  { key: 0, label: '全部时长' },
  { key: 1, label: '10 分钟以下' },
  { key: 2, label: '10~30 分钟' },
  { key: 3, label: '30~60 分钟' },
  { key: 4, label: '60 分钟以上' },
]

export function DurationFilter({
  active,
  onChange,
}: {
  active: DurationKey
  onChange: (key: DurationKey) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[12.5px] text-[var(--text-3)]">时长</span>
      {OPTIONS.map((option) => {
        const on = option.key === active
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={on}
            className={[
              't rounded-[4px] px-2 py-0.5 text-[13px]',
              on
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-2)] hover:text-[var(--accent)]',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
