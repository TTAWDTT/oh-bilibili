// Rust ↔ TS 的 IPC 契约。字段名与 Rust 侧逐字相同，由 golden 测试保证。

export type Track = {
  key: string
  title: string
  artist: string
  duration_ms: number | null
  cover: string | null
  views?: number | null
  danmaku?: number | null
  up_avatar?: string | null
  up_mid?: number | null
  tname?: string | null
  typeid?: number | null
}

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'faulted'
export type RepeatMode = 'off' | 'all' | 'one'

export type PlayerSnapshot = {
  phase: PlayerPhase
  track: Track | null
  local: boolean
  position_ms: number
  duration_ms: number
  volume: number
  speed: number
  repeat: RepeatMode
  shuffle: boolean
  quality_kbps: number | null
  mode: PlayMode
}

export type PlayMode = 'listen' | 'watch' 

export type Followed = {
  mid: number
  name: string
  face: string | null
  sign: string
  /** 0 个人认证、1 机构认证；null/undefined 表示未认证。 */
  official?: number | null
  vip?: boolean
  mutual?: boolean
  special?: boolean
}

/** 粉丝牌。颜色是接口原样的 0xAARRGGBB。 */
export type CommentMedal = {
  name: string
  level: number
  color: number
  color_end: number
  color_border: number
  color_name: number
  color_level: number
  level_bg: number
}

export type Comment = {
  id: string
  /** 一级评论 rpid。楼中楼「查看对话」用它定位根。 */
  root?: number
  /** 直接回复的 rpid。等于 root 表示直接回一级评论。 */
  parent?: number
  /** 对话分支起点 rpid。`dialog/cursor` 用它。 */
  dialog?: number
  /** 评论者 uid，用来标「UP主」。 */
  mid: number
  author: string
  avatar: string | null
  text: string
  /** 评论里的 B 站表情：代号（如 [doge]）到图片地址。 */
  emotes: [string, string][]
  /** 评论里 @ 到的用户：名字到 uid。 */
  mentions: [string, number][]
  /** 评论带图，最多九张。 */
  pictures: string[]
  /** 评论者等级。 */
  level: number
  /** 大会员。 */
  vip: boolean
  likes: number
  at: number
  replies: Comment[]
  reply_count: number
  /** UP 主置顶。B 站在这类评论上挂一个位置标记。 */
  pinned: boolean
  /** UP 主赞过这条评论。 */
  up_liked: boolean
  /** 当前登录账号赞过这条评论。 */
  liked: boolean
  /** 当前登录账号点踩过这条评论。 */
  disliked: boolean
  /** 评论者戴的粉丝牌。 */
  medal: CommentMedal | null
  /** B 站给的 IP 属地，形如「IP属地：上海」。旧评论可能没有。 */
  location: string | null
}

export type CommentPage = {
  total: number
  /** 老页码；翻页改游标后界面不再读它。 */
  page: number
  /** 下一页的游标；主评论列表和楼中楼都用它翻页，没有下一页时为 null。 */
  next: string | null
  items: Comment[]
  has_more: boolean
}

/** 观看页一次调用拿到的全部东西。manifest_url 已经带上本机代理端口。 */
export type PageRef = {
  no: number
  cid: number
  title: string
  duration_ms: number
}

export type WatchStats = {
  views: number
  danmaku: number
  likes: number
  coins: number
  favorites: number
  shares: number
  replies: number
}

export type WatchView = {
  key: string
  desc: string
  owner: string
  owner_mid: number | null
  owner_avatar: string | null
  stats: WatchStats
  pubdate: number
  tname: string | null
  pages: PageRef[]
  current_page: number
  /** 所属合集；没有合集时为 null。 */
  season: SeasonView | null
  manifest_url: string
  duration_ms: number
  qualities: QualityOption[]
  audio_quality: number | null
}

export type SeasonView = {
  id: number
  title: string
  episodes: SeasonEpisodeView[]
}

export type SeasonEpisodeView = {
  /** 视频的 key（bvid）。 */
  key: string
  title: string
  cover: string | null
  duration_ms: number
  views: number | null
  /** 当前正在看的就是这一集。 */
  current: boolean
}

export type PreciousView = {
  title: string
  /** B 站的官方文案，原样展示。 */
  explain: string
  items: PreciousItemView[]
}

export type PreciousItemView = {
  track: Track
  /** 这条视频的推荐语。 */
  note: string
}

/** 综合热门一页：条目 + 每条标题下的橙色小标签（可能为空串）。 */
export type PopularPage = {
  items: PopularItemView[]
  no_more: boolean
}

export type PopularItemView = {
  track: Track
  /** 「百万播放」「7万点赞」这类 B 站自己给的标签。 */
  note: string
}

export type QualityOption = {
  id: number
  label: string
  width: number
  height: number
  /** 源流码率。1080P 与 1080P+ 同高，切换时要靠它区分。 */
  bandwidth: number
}

export type VideoMeta = {
  desc: string
  pubdate: number
  views: number
  danmaku: number
  replies: number
  favorites: number
  coins: number
  shares: number
  likes: number
  /** 默认分 P 与完整分 P 列表。首推按同一 cid 取真实弹幕。 */
  current_page: number
  pages: PageRef[]
}

export type QueueView = {
  items: Track[]
  index: number | null
}

export type Playlist = { id: number; name: string }

export type LyricLine = { at_ms: number; text: string }

export type LyricDoc = {
  lines: LyricLine[]
  synced: boolean
  source: string
}

export type AuthUser = {
  mid: number
  uname: string
  avatar: string | null
  level: number
  coins: number
}

export type AuthSnapshot = { logged_in: boolean; user: AuthUser | null }

export type QrChallenge = { key: string; url: string; svg: string; expires_in_ms: number }

export type QrStatus = {
  state: 'waiting' | 'scanned' | 'confirmed' | 'expired'
  auth: AuthSnapshot | null
}

export type DownloadState = 'queued' | 'running' | 'done' | 'failed' | 'missing'

export type DownloadView = {
  key: string
  title: string
  state: DownloadState
  progress: number
  path: string | null
  error: string | null
}

export type ErrorClass =
  | 'retryable'
  | 'rate_limited'
  | 'needs_login'
  | 'input'
  | 'internal'

export type WireError = {
  class: ErrorClass
  message: string
  retry_after_ms?: number
  field?: string
}

export type SearchPage = { tracks: Track[]; page: number }

export type AppEvent =
  | { type: 'state'; snapshot: PlayerSnapshot }
  | {
      type: 'progress'
      position_ms: number
      duration_ms: number
      level: number
      /** 采样时刻（引擎单调毫秒），用来校正 IPC 延迟。 */
      sent_at_ms?: number
    }
  | { type: 'now_playing'; track: Track; index: number | null }
  | { type: 'buffering'; track: Track }
  | { type: 'stopped' }
  | { type: 'auth_changed'; auth: AuthSnapshot }
  | { type: 'notice'; error: WireError; op: string }
  | { type: 'download'; view: DownloadView }
  | { type: 'library_changed' }

export const EVENT_CHANNEL = 'bilimusic://event'
