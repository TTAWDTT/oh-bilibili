/**
 * B 站小电视插画。用在空态与加载态，替代灰块图标。
 *
 * 眼睛有一层极慢的眨眼动画：空态是一个会被看很久的画面，完全静止会显得像加载失败。
 */
export function BiliTvArt({ size = 72 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      className="bili-tv"
    >
      {/* 天线 */}
      <path
        d="M36 20 48 30l12-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <circle cx="48" cy="14" r="3" fill="currentColor" opacity="0.55" />

      {/* 机身 */}
      <rect
        x="12"
        y="30"
        width="72"
        height="50"
        rx="12"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.75"
      />

      {/* 屏幕 */}
      <rect x="22" y="40" width="52" height="30" rx="6" fill="currentColor" opacity="0.08" />

      {/* 眼睛 */}
      <g className="bili-tv__eyes" fill="currentColor">
        <rect x="33" y="49" width="6" height="12" rx="3" />
        <rect x="57" y="49" width="6" height="12" rx="3" />
      </g>

      {/* 微笑 */}
      <path
        d="M40 64c2.4 2.2 5 3.3 8 3.3s5.6-1.1 8-3.3"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  )
}
