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
    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
      {PARTITIONS.map((p) => {
        const on = p.label === active
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(on ? '全部' : p.label)}
            aria-pressed={on}
            className={[
              't shrink-0 whitespace-nowrap rounded-[4px] px-2.5 py-1 text-[14px]',
              on
                ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)] ring-1 ring-inset ring-[var(--accent)]'
                : 'bg-[var(--panel-raised)] text-[var(--text-2)] hover:text-[var(--text-1)]',
            ].join(' ')}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
