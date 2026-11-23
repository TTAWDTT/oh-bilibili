/** tid 是 B 站的一级分区 id（tids 参数用它）；ids 保留做展示与未来细化。 */
export type Partition = { label: string; tid?: number; ids: number[] }

export const PARTITIONS: Partition[] = [
  { label: '全部', ids: [] },
  // B 站音乐区用子分区 id，主类目 3 反而很少出现
  { label: '音乐', tid: 3, ids: [3, 28, 29, 30, 31, 59, 130, 193, 171] },
  { label: '舞蹈', tid: 129, ids: [129] },
  { label: '游戏', tid: 4, ids: [4, 17, 65, 136] },
  { label: '鬼畜', tid: 119, ids: [119] },
  { label: '动画', tid: 1, ids: [1, 24, 25, 47, 210] },
  { label: '生活', tid: 21, ids: [21, 76, 75, 160, 211, 217] },
  { label: '影视', tid: 181, ids: [181, 23, 11, 13] },
]

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
