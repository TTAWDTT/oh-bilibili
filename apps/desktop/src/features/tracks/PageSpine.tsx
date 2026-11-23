import { readResumePage, spineLabel } from './pageSpineLabel'

/**
 * 封面右缘的分 P 书脊。
 *
 * 只有列表确实带回了分 P 数才显示；单 P 或没有数据时不占位、不猜。
 * 有本地断点就写成 `P3 / 8`，没有就只写 `8 P`。
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
  const label = spineLabel(pages, resume)
  if (label === null) return null
  const spoken =
    resume !== null ? `本稿 ${pages} 个分 P，上次看到 P${resume}` : `本稿 ${pages} 个分 P`
  return (
    <span
      data-page-spine={pages}
      aria-label={spoken}
      title={spoken}
      className="num pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 rounded-l-[3px] bg-black/65 px-1 py-0.5 text-[10px] leading-[13px] text-white"
    >
      {label}
    </span>
  )
}
