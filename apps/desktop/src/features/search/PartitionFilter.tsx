import { PARTS } from '../../shared/lib/biliParts'

export type Partition = { label: string; tid?: number }

export const PARTITIONS: Partition[] = PARTS.map(({ rid, name }) =>
  rid === 0 ? { label: '全部' } : { label: name, tid: rid },
)

export function PartitionFilter({
  active,
  onChange,
}: {
  active: string
  onChange: (label: string) => void
}) {
  return (
    <div className="search-filter-row" role="group" aria-label="视频分区">
      <span>分区</span>
      <div>
        {PARTITIONS.map((p) => {
          const on = p.label === active
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(on ? '全部' : p.label)}
              aria-pressed={on}
            >
              {p.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
