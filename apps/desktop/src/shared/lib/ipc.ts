import { invoke } from '@tauri-apps/api/core'
import type { CommentPage, Followed, PlayMode, WatchView,
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
  duration?: number,
): Promise<Track[]> {
  const result = await call<Track[] | SearchPage>('search_q', {
    query,
    page,
    order,
    // 只取第一个当作一级分区 id（B 站 tids 的含义），空数组表示全站
    partition_ids: partitionIds && partitionIds.length > 0 ? [partitionIds[0]] : [],
    duration: duration === undefined ? null : duration,
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
  // 进度条给的是「比例 × 时长」，天然带小数；Rust 侧是 u64，带小数过去
  // 整条命令会被拒（实测拖到 100% 就弹「invalid type: floating point」）。
  // 单位换算是这里的边界，四舍五入一次就够了。
  return call<PlayerSnapshot>('player_seek', { position_ms: Math.max(0, Math.round(positionMs)) })
}

/** 设置播放倍速 0.5..2.0。 */
export function playerSetSpeed(speed: number): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_speed', { speed })
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

/** 从队列移除一首。 */
export function queueRemove(key: string): Promise<QueueView> {
  return call<QueueView>('queue_remove', { key })
}

/** 清空队列。 */
export function queueClear(): Promise<QueueView> {
  return call<QueueView>('queue_clear', {})
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

export type HistoryEntry = { track: Track; played_at: number }

/** 带播放时间的历史，用于按日期分组。 */
export function libraryHistoryTimed(limit: number): Promise<HistoryEntry[]> {
  return call<HistoryEntry[]>('library_history_timed', { limit })
}

/** 删掉某首歌的历史。 */
export function historyDelete(key: string): Promise<null> {
  return call<null>('history_delete', { key })
}

/** 清空历史。 */
export function historyClear(): Promise<null> {
  return call<null>('history_clear', {})
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

export function favSet(key: string, faved: boolean, folderId?: number | null): Promise<null> {
  return call<null>('fav_set', { key, faved, folder_id: folderId ?? null })
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
  level: number
  videos: number
  likes: number
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
export function favTracks(folderId: number, page = 1): Promise<Track[]> {
  return call<Track[]>('fav_tracks', { folder_id: folderId, page })
}

/** 从指定收藏夹移出。 */
export function unfavFrom(key: string, folderId: number): Promise<null> {
  return call<null>('unfav_from', { key, folder_id: folderId })
}

/** 删掉一条已下载的音轨（连文件一起）。 */
export function downloadRemove(key: string): Promise<DownloadView[]> {
  return call<DownloadView[]>('download_remove', { key })
}

/** 在访达里定位这个文件。 */
export function downloadReveal(key: string): Promise<null> {
  return call<null>('download_reveal', { key })
}

/** 加入或移出稍后再看。 */
export function watchLaterSet(key: string, on: boolean): Promise<null> {
  return call<null>('watch_later_set', { key, on })
}

/** 关注或取关 UP 主。 */
export function followSet(mid: number, on: boolean): Promise<null> {
  return call<null>('follow_set', { mid, on })
}

/** 当前账号有没有关注这个 UP 主。 */
export function relationFollowed(mid: number): Promise<boolean> {
  return call<boolean>('relation_followed', { mid })
}

/** 发评论。root 与 parent 都为空时是评论，否则是回复。 */
export function commentAdd(
  key: string,
  text: string,
  root?: string,
  parent?: string,
): Promise<string> {
  return call<string>('comment_add', { key, text, root, parent })
}

/** 删掉自己发的一条评论。 */
export function commentDel(key: string, rpid: string): Promise<null> {
  return call<null>('comment_del', { key, rpid })
}

/** 投币。count 1 或 2；also_like 为真时同时点赞（一键三连）。 */
/** 批量读互动状态：[key, liked, faved, coin][]。 */
export function relationStates(keys: string[]): Promise<[string, boolean, boolean, number][]> {
  return call<[string, boolean, boolean, number][]>('relation_states', { keys })
}

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
/** 发一条弹幕，落在 progress_ms 这一刻。 */
export function danmakuSend(key: string, text: string, progressMs: number): Promise<null> {
  return call<null>('danmaku_send', { key, text, progress_ms: progressMs })
}

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


/** 切换看/听。从看到听时传画面当前位置。 */
export function setMode(mode: PlayMode, atMs?: number, key?: string): Promise<PlayerSnapshot> {
  return invoke<PlayerSnapshot>('set_mode', { mode, at_ms: atMs ?? null, key: key ?? null })
}

/** UP 主投稿。返回 (列表, 总数)。 */
export function spaceVideos(mid: number, page: number): Promise<[Track[], number]> {
  return invoke<[Track[], number]>('space_videos', { mid, page })
}

/** UP 主粉丝与关注数。 */
export function spaceStat(mid: number): Promise<[number, number]> {
  return invoke<[number, number]>('space_stat', { mid })
}

/** 我关注的人。返回 (列表, 总数)。 */
export function following(page: number): Promise<[Followed[], number]> {
  return invoke<[Followed[], number]>('following', { page })
}

/** 稍后再看列表。 */
export function watchLaterList(): Promise<Track[]> {
  return invoke<Track[]>('watch_later_list')
}

/** 首页推荐。风控拒绝时返回空列表。 */
export function homeFeed(fresh: number): Promise<Track[]> {
  return invoke<Track[]>('home_feed', { fresh })
}

/** 取一页评论。 */
export function watchComments(key: string, page: number): Promise<CommentPage> {
  return invoke<CommentPage>('watch_comments', { key, page })
}

/** 打开观看页。返回的清单地址指向本机代理，不含任何远端地址。 */
export function watchOpen(key: string, page?: number): Promise<WatchView> {
  return invoke<WatchView>('watch_open', { key, page: page ?? null })
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
