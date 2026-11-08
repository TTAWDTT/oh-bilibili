/**
 * 22 娘与 33 娘，B 站最核心的形象资产。
 *
 * Q 版比例（头身比约 1:1.2）。22 娘蓝黑短发 + 小电视发饰，33 娘粉发双马尾 + 呆毛。
 * 两只都做了轻微上下浮动，相位错开，看起来像在互相点头。
 */
export function Bili2233({ width = 200 }: { width?: number }) {
  return (
    <svg viewBox="0 0 200 130" width={width} height={(width * 130) / 200} aria-hidden className="bili-2233">
      {/* ─── 22 娘 ─── */}
      <g className="bili-2233__girl-a">
        {/* 身体 */}
        <path d="M40 96h30l6 30H34Z" fill="#ffffff" stroke="#dbe1e8" strokeWidth="1.4" />
        <path d="M47 96l8 11 8-11" fill="none" stroke="#00AEEC" strokeWidth="1.8" strokeLinejoin="round" />
        {/* 双马尾 */}
        <path d="M30 74c-7 4-9 15-6 24 2-8 6-13 11-15Z" fill="#3f4d68" />
        <path d="M80 74c7 4 9 15 6 24-2-8-6-13-11-15Z" fill="#3f4d68" />
        {/* 脸 */}
        <rect x="38" y="52" width="34" height="42" rx="17" fill="#fdeade" />
        {/* 后发 */}
        <path d="M38 74V62c0-11 8-19 17-19s17 8 17 19v12c-2-10-8-15-17-15s-15 5-17 15Z" fill="#3f4d68" />
        {/* 刘海：中分 + 两侧碎发 */}
        <path d="M38 66c0-12 8-21 17-21s17 9 17 21c-4-8-8-11-11-11-2 4-5 6-6 6s-4-2-6-6c-3 0-7 3-11 11Z" fill="#3f4d68" />
        {/* 小电视发饰 */}
        <g transform="translate(64 44)">
          <rect x="0" y="0" width="17" height="13" rx="3.5" fill="#00AEEC" />
          <path d="M4 -3.5 7 0M13 -3.5 10 0" stroke="#00AEEC" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="5.5" cy="6.5" r="1.5" fill="#fff" />
          <circle cx="11.5" cy="6.5" r="1.5" fill="#fff" />
          <path d="M6 10q2.5 1.6 5 0" stroke="#fff" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        </g>
        {/* 眼睛 */}
        <ellipse cx="49" cy="72" rx="4" ry="5.4" fill="#2f3b52" />
        <ellipse cx="62" cy="72" rx="4" ry="5.4" fill="#2f3b52" />
        <circle cx="50.4" cy="70" r="1.5" fill="#fff" />
        <circle cx="63.4" cy="70" r="1.5" fill="#fff" />
        {/* 腮红 */}
        <ellipse cx="43" cy="80" rx="3.6" ry="2.2" fill="#ffb3c7" opacity="0.8" />
        <ellipse cx="68" cy="80" rx="3.6" ry="2.2" fill="#ffb3c7" opacity="0.8" />
        {/* 嘴 */}
        <path d="M52.5 81q3 2.8 6 0" stroke="#c2707f" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </g>

      {/* ─── 33 娘 ─── */}
      <g className="bili-2233__girl-b">
        {/* 身体 */}
        <path d="M138 96h30l6 30h-42Z" fill="#fff6f9" stroke="#f0cfd9" strokeWidth="1.4" />
        <path d="M145 96l8 11 8-11" fill="none" stroke="#fb7299" strokeWidth="1.8" strokeLinejoin="round" />
        {/* 双马尾（更翘） */}
        <path d="M132 72c-8 2-12 12-11 22 1-9 5-15 11-18Z" fill="#f2749a" />
        <path d="M178 72c8 2 12 12 11 22-1-9-5-15-11-18Z" fill="#f2749a" />
        {/* 脸 */}
        <rect x="136" y="52" width="34" height="42" rx="17" fill="#fdeade" />
        {/* 后发 */}
        <path d="M136 74V62c0-11 8-19 17-19s17 8 17 19v12c-2-10-8-15-17-15s-15 5-17 15Z" fill="#f2749a" />
        {/* 呆毛 */}
        <path d="M153 43q0-9 6-11-4 6-3 11Z" fill="#f2749a" />
        {/* 刘海 */}
        <path d="M136 66c0-12 8-21 17-21s17 9 17 21c-4-8-8-11-11-11-2 4-5 6-6 6s-4-2-6-6c-3 0-7 3-11 11Z" fill="#f2749a" />
        {/* 眼睛 */}
        <ellipse cx="147" cy="72" rx="4" ry="5.4" fill="#5a2b3a" />
        <ellipse cx="160" cy="72" rx="4" ry="5.4" fill="#5a2b3a" />
        <circle cx="148.4" cy="70" r="1.5" fill="#fff" />
        <circle cx="161.4" cy="70" r="1.5" fill="#fff" />
        {/* 腮红 */}
        <ellipse cx="141" cy="80" rx="3.6" ry="2.2" fill="#ffb3c7" opacity="0.8" />
        <ellipse cx="166" cy="80" rx="3.6" ry="2.2" fill="#ffb3c7" opacity="0.8" />
        {/* 嘴（张开的笑） */}
        <path d="M150 80q4 4 8 0Z" fill="#e0748a" stroke="#c2707f" strokeWidth="1.2" strokeLinejoin="round" />
      </g>

      {/* 爱心 */}
      <path
        className="bili-2233__heart"
        d="M100 74c0-3.4 2.6-5.6 5.4-5.6S111 70.6 111 74c0 4-5.4 8-5.4 8S100 78 100 74Z"
        fill="#fb7299"
        opacity="0.95"
      />
    </svg>
  )
}
