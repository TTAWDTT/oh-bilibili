/**
 * 时长筛选。B 站搜索页那一行「时长：全部 / 10分钟以下 / 10-30分钟 / 30-60分钟 / 60分钟以上」。
 *
 * 对应接口的 duration 参数：1 / 2 / 3 / 4，空表示不限。
 */
export type DurationKey = 0 | 1 | 2 | 3 | 4

export const DURATION_OPTIONS: { key: DurationKey; label: string }[] = [
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
    <div className="search-filter-row" role="group" aria-label="视频时长">
      <span>时长</span>
      <div>
        {DURATION_OPTIONS.map((option) => {
          const on = option.key === active
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(on ? 0 : option.key)}
              aria-pressed={on}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
