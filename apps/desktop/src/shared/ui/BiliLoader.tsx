/**
 * B 站式加载动画。
 *
 * 不是灰色骨架条，而是那只上下弹跳的小电视——B 站自己加载内容时就是这么做的。
 * 骨架屏传达「正在取数据」，这只电视传达「这里是 B 站」。
 */
export function BiliLoader({ label = '正在加载…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12" role="status" aria-live="polite">
      <svg viewBox="0 0 72 56" width="72" height="56" aria-hidden className="bili-loader">
        {/* 天线 */}
        <path d="M26 12 36 20M46 12 36 20" stroke="#00aeec" strokeWidth="2.6" strokeLinecap="round" />
        {/* 机身 */}
        <rect x="8" y="20" width="56" height="32" rx="9" fill="#00aeec" />
        {/* 屏幕 */}
        <rect x="16" y="27" width="40" height="18" rx="5" fill="#fff" opacity="0.92" />
        {/* 眼睛 */}
        <g className="bili-loader__eyes" fill="#00aeec">
          <rect x="24" y="32" width="4.5" height="9" rx="2.2" />
          <rect x="43" y="32" width="4.5" height="9" rx="2.2" />
        </g>
      </svg>
      <span className="text-[12px] text-[var(--text-3)]">{label}</span>
    </div>
  )
}
