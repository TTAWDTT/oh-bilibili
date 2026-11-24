import { BiliTvMark } from './BiliTvMark'

export function BiliLoader({
  label = '正在玩命加载…',
  compact = false,
}: {
  label?: string
  compact?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-center text-[var(--text-3)] ${compact ? 'gap-2 py-2 text-[12px]' : 'flex-col gap-3 py-12 text-[14px]'}`}
      role="status"
      aria-live="polite"
    >
      <BiliTvMark size={compact ? 24 : 56} className="bili-loader" />
      <span>{label}</span>
    </div>
  )
}
