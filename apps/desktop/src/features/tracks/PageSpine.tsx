import { readResumePage, spineLabel } from './pageSpineLabel'
import { readSeasonMark, seasonLabel } from './seasonMark'

/**
 * 封面侧边的内容书脊。
 *
 * 本稿有多个分 P 时写 `8 P`（有断点写 `P3 / 8`）；没有分 P 数但这一稿
 * 之前打开过、确认属于某个合集时写 `合集 · 12 稿`。两者都没有就不占位、不猜。
 * 合集稿数来自本地记下的真实目录，不在列表阶段发任何请求。
 *
 * 贴左缘中段而不是右缘：B 站封面习惯把 4K、Hi-Res 贴在右上角，
 * 右下角还有时长，放右边会和角标叠在一起。
 */
export function PageSpine({
  pages,
  trackKey,
}: {
  pages?: number | null | undefined
  trackKey?: string | undefined
}) {
  // 断点只对多 P 有意义，读 localStorage 也只发生在这少数卡片上。
  const resume = trackKey && pages && pages >= 2 ? readResumePage(trackKey) : null
  const season = pages && pages >= 2 ? null : readSeasonMark(trackKey)
  const label = spineLabel(pages, resume) ?? seasonLabel(season)
  if (label === null) return null
  const spoken = season
    ? `属于合集 ${season.title}，共 ${season.count} 稿`
    : resume !== null
      ? `本稿 ${pages} 个分 P，上次看到 P${resume}`
      : `本稿 ${pages} 个分 P`
  return (
    <span
      data-page-spine={pages ?? undefined}
      data-season-spine={season ? season.id : undefined}
      aria-label={spoken}
      title={spoken}
      className="num pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 rounded-r-[3px] bg-black/65 px-1 py-0.5 text-[10px] leading-[13px] text-white"
    >
      {label}
    </span>
  )
}
