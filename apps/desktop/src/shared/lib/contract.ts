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
}

export type Comment = {
  id: string
  author: string
  avatar: string | null
  text: string
  likes: number
  at: number
  replies: Comment[]
  reply_count: number
}

export type CommentPage = {
  total: number
  page: number
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
  stats: WatchStats
  pages: PageRef[]
  current_page: number
  manifest_url: string
  duration_ms: number
  qualities: QualityOption[]
  audio_quality: number | null
}

export type QualityOption = {
  id: number
  label: string
  width: number
  height: number
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

export type AuthUser = { mid: number; uname: string; avatar: string | null }

export type AuthSnapshot = { logged_in: boolean; user: AuthUser | null }

export type QrChallenge = { key: string; url: string; svg: string; expires_in_ms: number }

export type QrStatus = {
  state: 'waiting' | 'scanned' | 'confirmed' | 'expired'
  auth: AuthSnapshot | null
}

export type DownloadState = 'queued' | 'running' | 'done' | 'failed'

export type DownloadView = {
  key: string
  title: string
  state: DownloadState
  progress: number
  path: string | null
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
