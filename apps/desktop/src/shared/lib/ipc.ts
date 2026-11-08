import { invoke } from '@tauri-apps/api/core'
import type {
  AuthSnapshot,
  DownloadView,
  LyricDoc,
  PlayerSnapshot,
  Playlist,
  QrChallenge,
  QrStatus,
  QueueView,
  RepeatMode,
  SearchPage,
  Track,
} from './contract'
import { mockInvoke } from './mock'
import { isTauri } from './runtime'

export type Health = {
  ok: boolean
  version: string
  engine: string
  platform: string
}

type Args = Record<string, unknown>

async function call<T>(command: string, args: Args): Promise<T> {
  return isTauri ? invoke<T>(command, args) : (mockInvoke(command, args) as Promise<T>)
}

export function health(): Promise<Health> {
  if (isTauri) return invoke<Health>('health')
  return Promise.resolve({ ok: true, version: '0.1.0', engine: 'browser-mock', platform: 'web' })
}

/** 契约里同时存在 SearchPage 包裹形状；命令表按 Track[] 实现，两种都吃下来更稳。 */
export async function searchQ(query: string, page: number): Promise<Track[]> {
  const result = await call<Track[] | SearchPage>('search_q', { query, page })
  return Array.isArray(result) ? result : result.tracks
}

export function playerState(): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_state', {})
}

export function playerPlay(key: string): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_play', { key })
}

export function playerPlayContext(keys: string[], index: number): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_play_context', { keys, index })
}

export function playerToggle(): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_toggle', {})
}

export function playerNext(): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_next', {})
}

export function playerPrev(): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_prev', {})
}

export function playerSeek(positionMs: number): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_seek', { position_ms: positionMs })
}

export function playerVolume(volume: number): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_volume', { volume })
}

export function playerRepeat(mode: RepeatMode): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_repeat', { mode })
}

export function playerShuffle(on: boolean): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_shuffle', { on })
}

export function queueState(): Promise<QueueView> {
  return call<QueueView>('queue_state', {})
}

export function libraryPlaylists(): Promise<Playlist[]> {
  return call<Playlist[]>('library_playlists', {})
}

export function libraryCreate(name: string): Promise<Playlist> {
  return call<Playlist>('library_create', { name })
}

export function libraryAdd(playlistId: number, key: string): Promise<null> {
  return call<null>('library_add', { playlist_id: playlistId, key })
}

export function libraryTracks(playlistId: number): Promise<Track[]> {
  return call<Track[]>('library_tracks', { playlist_id: playlistId })
}

export function likeSet(key: string, liked: boolean): Promise<null> {
  return call<null>('like_set', { key, liked })
}

export function favSet(key: string, faved: boolean): Promise<null> {
  return call<null>('fav_set', { key, faved })
}

export function lyricsGet(key: string): Promise<LyricDoc> {
  return call<LyricDoc>('lyrics_get', { key })
}

export function authStatus(): Promise<AuthSnapshot> {
  return call<AuthSnapshot>('auth_status', {})
}

export function authQrCode(): Promise<QrChallenge> {
  return call<QrChallenge>('auth_qrcode', {})
}

export function authPoll(key: string): Promise<QrStatus> {
  return call<QrStatus>('auth_poll', { key })
}

export function authLogout(): Promise<AuthSnapshot> {
  return call<AuthSnapshot>('auth_logout', {})
}

export function downloadEnqueue(key: string): Promise<DownloadView> {
  return call<DownloadView>('download_enqueue', { key })
}

export function downloadsList(): Promise<DownloadView[]> {
  return call<DownloadView[]>('downloads_list', {})
}

export function syncNow(): Promise<null> {
  return call<null>('sync_now', {})
}
