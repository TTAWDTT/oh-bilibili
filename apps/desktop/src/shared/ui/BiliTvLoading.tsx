import { BiliTvMark } from './BiliTvMark'

/**
 * 加载态：B 站官方小电视在原地轻轻起伏。
 *
 * 比一排灰条有话说——用户看到它就知道「在等 B 站的数据」，而不是「页面坏了」。
 */
export function BiliTvLoading({ label = '加载中' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12" role="status" aria-live="polite">
      <BiliTvMark size={34} className="bili-tv-load text-[var(--accent)]" />
      <span className="text-[12px] text-[var(--text-3)]">{label}</span>
    </div>
  )
}
