import type { ReactNode } from 'react'

const ICONS = {
  /** B 站小电视。用在「音源来自 B 站」这类需要点明来源的位置。 */
  /** B 站官网 header 里那颗小电视的原始 path，直接取自它的页面。 */
  biliTv: (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M3.73252 2.67094C3.33229 2.28484 3.33229 1.64373 3.73252 1.25764C4.11291 0.890684 4.71552 0.890684 5.09591 1.25764L7.21723 3.30403C7.27749 3.36218 7.32869 3.4261 7.37081 3.49407H10.5789C10.6211 3.4261 10.6723 3.36218 10.7325 3.30403L12.8538 1.25764C13.2342 0.890684 13.8368 0.890684 14.2172 1.25764C14.6175 1.64373 14.6175 2.28484 14.2172 2.67094L13.364 3.49407H14C16.2091 3.49407 18 5.28493 18 7.49407V12.9996C18 15.2087 16.2091 16.9996 14 16.9996H4C1.79086 16.9996 0 15.2087 0 12.9996V7.49406C0 5.28492 1.79086 3.49407 4 3.49407H4.58579L3.73252 2.67094ZM4 5.42343C2.89543 5.42343 2 6.31886 2 7.42343V13.0702C2 14.1748 2.89543 15.0702 4 15.0702H14C15.1046 15.0702 16 14.1748 16 13.0702V7.42343C16 6.31886 15.1046 5.42343 14 5.42343H4ZM5 9.31747C5 8.76519 5.44772 8.31747 6 8.31747C6.55228 8.31747 7 8.76519 7 9.31747V10.2115C7 10.7638 6.55228 11.2115 6 11.2115C5.44772 11.2115 5 10.7638 5 10.2115V9.31747ZM12 8.31747C11.4477 8.31747 11 8.76519 11 9.31747V10.2115C11 10.7638 11.4477 11.2115 12 11.2115C12.5523 11.2115 13 10.7638 13 10.2115V9.31747C13 8.76519 12.5523 8.31747 12 8.31747Z" fill="currentColor" />
    </>
  ),
  /** 投币：B 站的硬币是圆形加两道横纹，投出去会翻面。 */
  coin: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 9.6h6.8M8.6 14.4h6.8" strokeWidth="1.3" />
      <path d="M12 9.6v4.8" strokeWidth="1.3" />
    </>
  ),
  /** 点赞：B 站用的是拇指，不是爱心。 */
  thumb: (
    <>
      <path d="M7.6 10.4v9M7.6 10.4l3.4-6.2c1.4 0 2.2 1 2.2 2.3V9h4.2c1.2 0 2 1 1.8 2.2l-1 6.2c-.2 1.1-1.2 2-2.3 2H7.6" />
    </>
  ),
  /** 点赞（已赞）：实心拇指。 */
  thumbFilled: (
    <>
      <path
        d="M7.6 10.4v9M7.6 10.4l3.4-6.2c1.4 0 2.2 1 2.2 2.3V9h4.2c1.2 0 2 1 1.8 2.2l-1 6.2c-.2 1.1-1.2 2-2.3 2H7.6"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  /** 点踩：拇指朝下。B 站每条评论右侧都有一枚，空心线稿。 */
  thumbDown: (
    <>
      <path d="M16.4 13.6v-9M16.4 13.6 13 19.8c-1.4 0-2.2-1-2.2-2.3V15H6.6c-1.2 0-2-1-1.8-2.2l1-6.2c.2-1.1 1.2-2 2.3-2h8.3" />
    </>
  ),
  /** 拖拽柄：两列小圆点。 */
  grip: (
    <>
      <circle cx="8" cy="5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="15" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  /** 特别关注：B 站头像角上那颗小星星。 */
  star: (
    <>
      <path d="m12 3.6 2.5 5.1 5.6.8-4.1 4 1 5.5-5-2.6-5 2.6 1-5.5-4.1-4 5.6-.8L12 3.6Z" fill="currentColor" stroke="none" />
    </>
  ),
  /** 收藏：B 站是带星的书签。 */
  bookmarkStar: (
    <>
      <path d="M6.8 3.6h10.4v16.8L12 16.4l-5.2 4V3.6Z" />
      <path d="m12 6.2.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3L12 6.2Z" strokeWidth="1.1" />
    </>
  ),
  /** 稍后再看：B 站是小电视加时钟。 */
  watchLater: (
    <>
      <rect x="3.4" y="6.6" width="17.2" height="12.6" rx="2.6" />
      <path d="M9 6.6 12 3.4M15 6.6 12 3.4" />
      <circle cx="12" cy="12.9" r="3.1" />
      <path d="M12 11.4v1.6l1.2.9" strokeWidth="1.3" />
    </>
  ),
  message: (
    <>
      <path d="M7 4.5h10a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5h-6l-5 3v-3.2A3.5 3.5 0 0 1 3.5 14V8A3.5 3.5 0 0 1 7 4.5Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4.2 4.2" />
    </>
  ),
  /** 排行榜：三根递增的柱子。 */
  rank: (
    <>
      <path d="M5 19v-5.5" />
      <path d="M12 19V9.5" />
      <path d="M19 19V4.5" />
    </>
  ),
  library: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  heart: <path d="M12 20s-7.2-4.4-7.2-9.1A4 4 0 0 1 12 8.4a4 4 0 0 1 7.2 2.5C19.2 15.6 12 20 12 20Z" />,
  heartFilled: (
    <path
      d="M12 20s-7.2-4.4-7.2-9.1A4 4 0 0 1 12 8.4a4 4 0 0 1 7.2 2.5C19.2 15.6 12 20 12 20Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  bookmark: <path d="M7 4.8h10a1.2 1.2 0 0 1 1.2 1.2v14l-6.2-4.2L5.8 20V6A1.2 1.2 0 0 1 7 4.8Z" />,
  bookmarkFilled: (
    <path
      d="M7 4.8h10a1.2 1.2 0 0 1 1.2 1.2v14l-6.2-4.2L5.8 20V6A1.2 1.2 0 0 1 7 4.8Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10.6 4 3.8 4-3.8" />
      <path d="M5 19h14" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.4l3 1.8" />
    </>
  ),
  play: <path d="M9 6.4v11.2L18.5 12 9 6.4Z" fill="currentColor" stroke="none" />,
  /** 弹幕：B 站卡片左下角那枚「小屏幕 + 两条字」。 */
  danmaku: (
    <>
      <rect x="3" y="6.2" width="18" height="11.6" rx="2.6" />
      <path d="M6.6 10.6h7.4M6.6 13.8h4.6" strokeLinecap="round" />
    </>
  ),
  pause: (
    <>
      <rect x="8" y="6" width="2.8" height="12" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.2" y="6" width="2.8" height="12" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  prev: (
    <>
      <path d="M18.5 6v12" />
      <path d="M15.5 12 7 6.4v11.2L15.5 12Z" fill="currentColor" stroke="none" />
    </>
  ),
  next: (
    <>
      <path d="M5.5 6v12" />
      <path d="M8.5 12 17 6.4v11.2L8.5 12Z" fill="currentColor" stroke="none" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4 7h3.2l3 5" />
      <path d="M4 17h3.2l9-10H20" />
      <path d="m17.4 4.6 2.6 2.4-2.6 2.4" />
      <path d="m17.4 14.6 2.6 2.4-2.6 2.4" />
    </>
  ),
  repeat: (
    <>
      <path d="M6 9V8a3 3 0 0 1 3-3h9" />
      <path d="m15.6 2.6 2.6 2.4-2.6 2.4" />
      <path d="M18 15v1a3 3 0 0 1-3 3H6" />
      <path d="m8.4 21.4-2.6-2.4 2.6-2.4" />
    </>
  ),
  repeatOne: (
    <>
      <path d="M6 9V8a3 3 0 0 1 3-3h9" />
      <path d="m15.6 2.6 2.6 2.4-2.6 2.4" />
      <path d="M18 15v1a3 3 0 0 1-3 3H6" />
      <path d="m8.4 21.4-2.6-2.4 2.6-2.4" />
      <path d="M11 10.2 12.2 9.4v5.2" />
    </>
  ),
  volume: (
    <>
      <path d="M5 10v4h3l4 3.4V6.6L8 10H5Z" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6" />
    </>
  ),
  mute: (
    <>
      <path d="M5 10v4h3l4 3.4V6.6L8 10H5Z" />
      <path d="m16 10 4 4M20 10l-4 4" />
    </>
  ),
  lyrics: (
    <>
      <path d="M5 7h9M5 12h13M5 17h7" />
      <circle cx="18" cy="16.5" r="1.6" />
    </>
  ),
  headphones: (
    <>
      <path d="M4.8 15v-2.6a7.2 7.2 0 0 1 14.4 0V15" />
      <path d="M4.8 14.2h2.3a1 1 0 0 1 1 1v3.6a1 1 0 0 1-1 1H5.8a1 1 0 0 1-1-1v-4.6ZM19.2 14.2h-2.3a1 1 0 0 0-1 1v3.6a1 1 0 0 0 1 1h1.3a1 1 0 0 0 1-1v-4.6Z" />
    </>
  ),
  queue: (
    <>
      <path d="M5 7h10M5 12h10M5 17h6" />
      <path d="m16.8 10.4 4 2.6-4 2.6V10.4Z" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5.5 12.5 4.2 4.2L18.5 8" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M20 4.2v4.6h-4.6" />
    </>
  ),
  settings: (
    <>
      <path d="M5 8h14M5 16h14" />
      <circle cx="9.5" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="16" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M5.2 20c.8-4 3.4-5.8 6.8-5.8s6 1.8 6.8 5.8" />
    </>
  ),
  logout: (
    <>
      <path d="M14 5.5H7.5A1.5 1.5 0 0 0 6 7v10a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M12.5 12h8M17.5 8.8 20.8 12l-3.3 3.2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6v5.2" />
      <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5.2" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="10" height="11" rx="2" />
      <path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </>
  ),
  /** 嵌入代码：一对尖括号。 */
  code: (
    <>
      <path d="M9 7.5 4.5 12 9 16.5M15 7.5 19.5 12 15 16.5" />
    </>
  ),
  /** 专栏：带几行正文的稿纸。 */
  article: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8 8h8M8 11.5h8M8 15h5" strokeWidth="1.3" />
    </>
  ),
  /** 分享：B 站工具栏那枚「带尾巴的右箭头」。 */
  share: (
    <>
      <path d="m13.4 5.8 6.1 6.2-6.1 6.2" />
      <path d="M19.2 12H9.6a4.6 4.6 0 0 0 0 9.2h2.9" />
    </>
  ),
  /** 外链：一个框加一支从框里出去的箭头。 */
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M4 9V5h4" />
      <path d="M20 9V5h-4" />
      <path d="M4 15v4h4" />
      <path d="M20 15v4h-4" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  rocket: (
    <>
      <path d="M12 3c-2.7 1.8-4 4.6-4 8v4h8v-4c0-3.4-1.3-6.2-4-8Z" />
      <circle cx="12" cy="8.5" r="1.6" />
      <path d="m8 10-3 3v4l3-2M16 10l3 3v4l-3-2" />
      <path d="M10 18c0 1.5 2 3 2 3s2-1.5 2-3" />
    </>
  ),
  music: (
    <>
      <path d="M9.5 18V6.8l9-2v11" />
      <circle cx="7" cy="18" r="2.3" />
      <circle cx="16.5" cy="15.8" r="2.3" />
    </>
  ),
  game: (
    <>
      <path d="M7.4 8.8h9.2a3.6 3.6 0 0 1 3.5 4.4l-.6 3a2.5 2.5 0 0 1-4.3 1.3l-1.6-1.7h-3.2l-1.6 1.7a2.5 2.5 0 0 1-4.3-1.3l-.6-3a3.6 3.6 0 0 1 3.5-4.4Z" />
      <path d="M8.6 11.8v2.4M7.4 13h2.4" />
      <circle cx="15.3" cy="12.6" r=".9" />
      <circle cx="17.1" cy="14.4" r=".9" />
    </>
  ),
  sync: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3l2.2 2.1" />
      <path d="M19.5 4.4v4.4H15" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3l-2.2-2.1" />
      <path d="M4.5 19.6v-4.4H9" />
    </>
  ),
  /** 热门：火苗。 */
  flame: (
    <>
      <path d="M12 3.2c3.4 3 5.2 5.6 5.2 8.6a5.2 5.2 0 0 1-10.4 0c0-3 1.8-5.6 5.2-8.6Z" />
      <path d="M12 20.8c-1.7-1.5-2.6-2.9-2.6-4.4a2.6 2.6 0 0 1 5.2 0c0 1.5-.9 2.9-2.6 4.4Z" />
    </>
  ),
  /** 入站必刷：礼物盒。 */
  gift: (
    <>
      <path d="M4 11.4h16v8.2a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 19.6v-8.2Z" />
      <path d="M3 7.8h18v3.6H3z" />
      <path d="M12 7.8v13" />
      <path d="M12 7.8c-1.4 0-4.6-.3-4.6-2.3a1.9 1.9 0 0 1 3.2-1.3c.9.9 1.4 2.2 1.4 3.6Z" />
      <path d="M12 7.8c1.4 0 4.6-.3 4.6-2.3a1.9 1.9 0 0 0-3.2-1.3c-.9.9-1.4 2.2-1.4 3.6Z" />
    </>
  ),
  /** 文件夹：打开下载目录。 */
  folder: (
    <path d="M3.6 6.4h5.8l1.9 2.3h9.1a1.2 1.2 0 0 1 1.2 1.2v8.5a1.2 1.2 0 0 1-1.2 1.2H3.6a1.2 1.2 0 0 1-1.2-1.2V7.6a1.2 1.2 0 0 1 1.2-1.2Z" />
  ),
  /** 每周必看：日历。 */
  calendar: (
    <>
      <path d="M4.2 6.6h15.6a1.2 1.2 0 0 1 1.2 1.2v11a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 18.8v-11a1.2 1.2 0 0 1 1.2-1.2Z" />
      <path d="M3 10.8h18" />
      <path d="M8 3.8v4.2M16 3.8v4.2" />
    </>
  ),
  /** 充电：B 站这根斜插的闪电，比正立的闪电更像它在按钮里用的那颗。 */
  battery: (
    <path d="M13.4 2.8 5.2 13.4h5.2l-1 7.8 8.4-10.8h-5.3l1.1-7.6Z" />
  ),
  /** 动态：B 站的闪电。 */
  dynamic: <path d="M13.4 2.8 5.2 13.4h5.2l-1 7.8 8.4-10.8h-5.3l1.1-7.6Z" fill="currentColor" stroke="none" />,
  /** 直播：一块屏幕加两圈往外扩的声波，表达「现在正在播」。 */
  live: (
    <>
      <rect x="2.8" y="6.2" width="13.4" height="11.6" rx="2.2" />
      <path d="M16.2 12.4 21.4 9.4v5.2l-5.2-2.2Z" />
      <path d="M6.6 10.6h3.2M6.6 13.6h3.2" />
    </>
  ),
  /** 番剧：一张竖版海报，右上角压一颗星，表示追番。 */
  bangumi: (
    <>
      <rect x="4.4" y="3.4" width="15.2" height="17.2" rx="2" />
      <path d="M8.2 20.6V17h7.6v3.6" />
      <path d="m14.8 7.4 1.1 2.2 2.4.4-1.7 1.7.4 2.4-2.2-1.1-2.2 1.1.4-2.4L11.3 10l2.4-.4 1.1-2.2Z" fill="currentColor" stroke="none" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}
