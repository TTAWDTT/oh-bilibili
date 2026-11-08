/**
 * 分区筛选栏。B 站搜索页顶部那排「全部 / 音乐 / 游戏 / 影视」。
 *
 * B 站的搜索接口已经不接受 tids 参数（实测传了直接返回 0 条），
 * 所以这里改成按返回结果的 typeid 在前端过滤——分区是接口给的真数据。
 */
export type Partition = { label: string; ids: number[] }

export const PARTITIONS: Partition[] = [
  { label: '全部', ids: [] },
  // B 站音乐区用子分区 id，主类目 3 反而很少出现
  { label: '音乐', ids: [3, 28, 29, 30, 31, 59, 130, 193, 171] },
  { label: '舞蹈', ids: [129] },
  { label: '游戏', ids: [4, 17, 65, 136] },
  { label: '鬼畜', ids: [119] },
  { label: '动画', ids: [1, 24, 25, 47, 210] },
  { label: '生活', ids: [21, 76, 75, 160, 211, 217] },
  { label: '影视', ids: [181, 23, 11, 13] },
]

export function matchesPartition(typeid: number | undefined, partition: Partition): boolean {
  if (partition.ids.length === 0) return true
  return typeid !== undefined && partition.ids.includes(typeid)
}

export function PartitionFilter({
  active,
  onChange,
}: {
  active: string
  onChange: (label: string) => void
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {PARTITIONS.map((p) => {
        const on = p.label === active
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.label)}
            aria-pressed={on}
            className={[
              't rounded-[4px] px-2.5 py-1 text-[12px]',
              on
                ? 'bg-[var(--accent)] text-white'
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
