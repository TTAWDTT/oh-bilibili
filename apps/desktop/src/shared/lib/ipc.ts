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
export async function searchQ(
  query: string,
  page: number,
  order?: string,
  partitionIds?: number[],
): Promise<Track[]> {
  const result = await call<Track[] | SearchPage>('search_q', {
    query,
    page,
    order,
    // 只取第一个当作一级分区 id（B 站 tids 的含义），空数组表示全站
    partition_ids: partitionIds && partitionIds.length > 0 ? [partitionIds[0]] : [],
  })
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

/** 队列恢复进度 (已补, 总数)；没有在恢复时为 null。 */
export function queueRestoreProgress(): Promise<[number, number] | null> {
  return call<[number, number] | null>('queue_restore_progress', {})
}

/** 队列内重排。两个参数都是曲目键，后端换成条目身份再移动。 */
export function queueMove(from: string, to: string): Promise<QueueView> {
  return call<QueueView>('queue_move', { from, to })
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

export function libraryHistory(limit: number): Promise<Track[]> {
  return call<Track[]>('library_history', { limit })
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

export type AuthorCard = {
  name: string
  face: string
  fans: number
  sign: string
  official: string | null
}

/** UP 主名片：粉丝数、签名、认证。 */
export function authorCard(mid: number): Promise<AuthorCard> {
  return call<AuthorCard>('author_card', { mid })
}

export type FavFolder = { id: number; title: string; count: number }

/** 当前账号的收藏夹。 */
export function favFolders(): Promise<FavFolder[]> {
  return call<FavFolder[]>('fav_folders', {})
}

/** 某个收藏夹里的曲目。 */
export function favTracks(folderId: number): Promise<Track[]> {
  return call<Track[]>('fav_tracks', { folder_id: folderId })
}

/** 加入或移出稍后再看。 */
export function watchLaterSet(key: string, on: boolean): Promise<null> {
  return call<null>('watch_later_set', { key, on })
}

/** 关注或取关 UP 主。 */
export function followSet(mid: number, on: boolean): Promise<null> {
  return call<null>('follow_set', { mid, on })
}

/** 投币。count 1 或 2；also_like 为真时同时点赞（一键三连）。 */
export function coinAdd(key: string, count: number, alsoLike: boolean): Promise<null> {
  return call<null>('coin_set', { key, count, also_like: alsoLike })
}

/** 这条视频的真实弹幕。 */
export function danmaku(key: string): Promise<string[]> {
  return call<string[]>('danmaku', { key })
}

/** 视频详情元信息。 */
export function videoMeta(key: string): Promise<import('./contract').VideoMeta> {
  return call<import('./contract').VideoMeta>('video_meta', { key })
}

/** 相关推荐。 */
export function related(key: string): Promise<Track[]> {
  return call<Track[]>('related', { key })
}

/** 带颜色的弹幕：时间、文本、十进制 RGB。 */
export function danmakuColored(key: string): Promise<[number, string, number][]> {
  return call<[number, string, number][]>('danmaku_colored', { key })
}

/** 弹幕密度曲线，用来画高能进度条。 */
export function danmakuHeat(key: string, buckets: number): Promise<number[]> {
  return call<number[]>('danmaku_heat', { key, buckets })
}

/** 本地 MV 代理端口。浏览器预览没有这个能力，返回 0。 */
export async function mvPort(): Promise<number> {
  try {
    return await call<number>('mv_port', {})
  } catch {
    return 0
  }
}

/** 取一条可播放的 mp4 直链；必须经本地代理转发才有 Referer。 */
export function mvSource(key: string): Promise<string> {
  return call<string>('mv_source', { key })
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
