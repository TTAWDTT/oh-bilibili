import type React from 'react'
import { PartitionIcon } from '../../shared/ui/PartitionIcon'

/**
 * 分区入口。B 站首页中部那排彩色分区卡。
 *
 * 每张卡点进去就是一次真实搜索（用分区名当关键词），不是装饰。
 */
type Entry = {
  label: string
  kind: 'music' | 'dance' | 'game' | 'anime' | 'life' | 'film'
  keyword: string
  hint: string
}

const ENTRIES: Entry[] = [
  { label: '音乐', kind: 'music', keyword: '音乐', hint: '华语 · 现场 · 纯音乐' },
  { label: '舞蹈', kind: 'dance', keyword: '舞蹈', hint: '宅舞 · 街舞 · 翻跳' },
  { label: '游戏', kind: 'game', keyword: '游戏', hint: '实况 · 攻略 · 混剪' },
  { label: '动画', kind: 'anime', keyword: '动画', hint: 'MAD · AMV · 手书' },
  { label: '生活', kind: 'life', keyword: '生活', hint: '日常 · 美食 · 旅行' },
  { label: '影视', kind: 'film', keyword: '影视', hint: '混剪 · 解析 · 预告' },
]

export function ChannelGrid({ onPick }: { onPick: (keyword: string) => void }) {
  return (
    <div className="mt-8">
      <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--text-2)]">逛逛分区</div>
      <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
        {ENTRIES.map((entry, i) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => onPick(entry.keyword)}
            className="bili-card bili-card-enter bili-press flex items-center gap-2.5 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-left"
            style={{ '--i': i } as React.CSSProperties}
          >
            <PartitionIcon kind={entry.kind} size={26} />
            <span className="min-w-0">
              <span className="block text-[14px] text-[var(--text-1)]">{entry.label}</span>
              <span className="block truncate text-[12px] text-[var(--text-3)]">{entry.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
