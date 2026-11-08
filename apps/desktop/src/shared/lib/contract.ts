// Rust ↔ TS 的 IPC 契约。字段名与 Rust 侧逐字相同，由 golden 测试保证。

export type Track = {
  key: string
  title: string
  artist: string
  duration_ms: number | null
  cover: string | null
}

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'faulted'
export type RepeatMode = 'off' | 'all' | 'one'

export type PlayerSnapshot = {
  phase: PlayerPhase
  track: Track | null
  position_ms: number
  duration_ms: number
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  quality_kbps: number | null
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
  | { type: 'progress'; position_ms: number; duration_ms: number; level: number }
  | { type: 'now_playing'; track: Track; index: number | null }
  | { type: 'buffering'; track: Track }
  | { type: 'stopped' }
  | { type: 'auth_changed'; auth: AuthSnapshot }
  | { type: 'notice'; error: WireError; op: string }
  | { type: 'download'; view: DownloadView }
  | { type: 'library_changed' }

export const EVENT_CHANNEL = 'bilimusic://event'
