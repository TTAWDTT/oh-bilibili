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
  PopularPage,
  PreciousView,
  RepeatMode,
  SearchPage,
  SeasonView,
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

export function playerPlayLocal(key: string): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_play_local', { key })
}

export function playerPlayContext(keys: string[], index: number): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_play_context', { keys, index })
}

/** 只暂停；已经在暂停时什么也不做。离开观看页用它收声音。 */
export function playerPause(): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_pause', {})
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

/** 从头重播当前视频。结束态只 seek 回不到 playing，要重新挂载一次。 */
export function playerReplay(): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('player_replay', {})
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

/** 撤销最近一次清空。 */
export function queueUndoClear(): Promise<QueueView> {
  return call<QueueView>('queue_undo_clear', {})
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

export type HistoryEntry = { id: number; track: Track; played_at: number; position_ms: number }

/** 带播放时间的历史。翻页传上一页最旧一条的 (played_at, id) 作为边界。 */
export function libraryHistoryTimed(
  limit: number,
  before?: { played_at: number; id: number },
): Promise<HistoryEntry[]> {
  return call<HistoryEntry[]>('library_history_timed', {
    limit,
    before_played_at: before?.played_at ?? null,
    before_id: before?.id ?? null,
  })
}

/** 某条视频上次看到的位置。没看过返回 null，和「看过但从 0 开始」区分开。 */
export function historyPosition(key: string): Promise<number | null> {
  return call<number | null>('history_position', { key })
}

/** 批量查历史进度：[key, position_ms]。右栏推荐用它画看过的进度条。 */
export function historyPositions(keys: string[]): Promise<[string, number][]> {
  return call<[string, number][]>('history_positions', { keys })
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
  /** 0 个人、1 机构；null 未认证。 */
  official_type?: number | null
  level: number
  /** 大会员。 */
  vip?: boolean
  videos: number
  likes: number
}

/** UP 主名片：粉丝数、签名、认证。 */
export function authorCard(mid: number): Promise<AuthorCard> {
  return call<AuthorCard>('author_card', { mid })
}

export type FavFolder = { id: number; title: string; count: number; cover: string | null }

/** 当前账号的收藏夹。 */
export function favFolders(): Promise<FavFolder[]> {
  return call<FavFolder[]>('fav_folders', {})
}

/** 收藏夹列表页的四宫格封面。 */
export function favCovers(folderId: number, limit = 4): Promise<string[]> {
  return call<string[]>('fav_covers', { folder_id: folderId, limit })
}

/** 我赞过的视频（账号里的真实点赞）。 */
export function likedVideos(): Promise<Track[]> {
  return call<Track[]>('liked_videos', {})
}

/** 视频标签。 */
export function videoTags(key: string): Promise<string[]> {
  return call<string[]>('video_tags', { key })
}

/** 评论表情面板：代号 → 图片。 */
export function commentEmotes(): Promise<[string, string][]> {
  return call<[string, string][]>('comment_emotes', {})
}

export type UserHit = {
  mid: number
  name: string
  face: string | null
  fans: number
  videos: number
  sign: string
  level: number
  /** 0 个人认证、1 机构认证；null 表示未认证。 */
  official?: number | null
  verify?: string
  live?: boolean
}

/** 搜 UP 主。 */
export function searchUsers(keyword: string, page = 1): Promise<UserHit[]> {
  return call<UserHit[]>('search_users', { keyword, page })
}

/** 排行榜。rid=0 是全站。 */
export function ranking(rid = 0): Promise<Track[]> {
  return call<Track[]>('ranking', { rid })
}

/** 分区最新投稿。发现页选中一个分区时读它，不跳去排行榜。 */
export function regionNew(rid: number, page = 1): Promise<Track[]> {
  return call<Track[]>('region_new', { rid, page })
}

/** 直播推荐位的一张卡。 */
export type LiveRoom = {
  room_id: number
  title: string
  uname: string
  face: string | null
  cover: string | null
  area: string
  online: number
  url: string
}

/** 番剧排行的一条。 */
export type Bangumi = {
  season_id: number
  title: string
  cover: string | null
  rank: number
  rating: string
  index_show: string
  play_text: string
  url: string
}

/** 正在直播的房间。直播流本机解不了，点开交给系统浏览器。 */
export function liveRooms(count = 6, page = 1): Promise<LiveRoom[]> {
  return call<LiveRoom[]>('live_rooms', { count, page })
}

/** 番剧时间表的一天。 */
export type BangumiDay = {
  date: string
  /** 1=周一 … 7=周日 */
  weekday: number
  today: boolean
  episodes: {
    season_id: number
    title: string
    cover: string | null
    pub_index: string
    pub_time: string
    url: string
  }[]
}

/** 一周的番剧更新表。 */
export function bangumiTimeline(): Promise<BangumiDay[]> {
  return call<BangumiDay[]>('bangumi_timeline', {})
}

/** 番剧排行。 */
export function bangumiRank(count = 6, seasonType = 1): Promise<Bangumi[]> {
  return call<Bangumi[]>('bangumi_rank', { count, season_type: seasonType })
}

/** 当前账号的追番，每页 20 条。 */
export function followedBangumi(page = 1): Promise<[Bangumi[], number]> {
  return call<[Bangumi[], number]>('followed_bangumi', { page })
}

/** 综合热门。一次 50 条，`no_more` 表示是否到底；每条带 B 站的小标签。 */
export function popular(page = 1): Promise<PopularPage> {
  return call<PopularPage>('popular', { page })
}

/** 入站必刷。一次取完，每条带一句 B 站写的推荐语。 */
export type WeeklyIssue = {
  number: number
  subject: string
  name: string
}

export type WeeklyPage = {
  subject: string
  label: string
  tracks: Track[]
  /** 每条的推荐语，按曲目 key 对齐。 */
  notes: Record<string, string>
}

/** 每周必看的期数列表。 */
export function weeklyIssues(): Promise<WeeklyIssue[]> {
  return call<WeeklyIssue[]>('weekly_issues', {})
}

/** 每周必看某一期的片单。 */
export function weeklyIssue(number: number): Promise<WeeklyPage> {
  return call<WeeklyPage>('weekly_issue', { number })
}

export function precious(): Promise<PreciousView> {
  return call<PreciousView>('precious', {})
}

/** 一条字幕：出现在 `at_ms`，`end_ms` 之后不该再显示。 */
export type SubtitleCue = { at_ms: number; end_ms: number; text: string }

export type SubtitleTrack = { lan: string; label: string }

/** 观看页元信息：在看人数 + 可用字幕轨（后端一次请求拿齐）。 */
export type WatchMeta = {
  online: number
  subtitles: SubtitleTrack[]
  /** UP 主设的播放器章节；`at_ms` 已从接口的秒换算成毫秒。 */
  chapters: { at_ms: number; title: string }[]
}

export function watchMeta(key: string, cid: number): Promise<WatchMeta> {
  return call<WatchMeta>('watch_meta', { key, cid })
}

/** B 站给这条视频生成的 AI 总结；没有总结的稿件返回 null。 */
export type SummaryPoint = { at_ms: number; content: string }
export type SummarySection = { title: string; at_ms: number; points: SummaryPoint[] }
export type VideoSummary = { summary: string; outline: SummarySection[] }

export function watchSummary(
  key: string,
  cid: number,
  upMid: number,
): Promise<VideoSummary | null> {
  return call<VideoSummary | null>('watch_summary', { key, cid, up_mid: upMid })
}

/** 取一条字幕轨的全部台词；`lan` 为空时后端优先中文。 */
export function watchSubtitles(key: string, lan: string | null, cid?: number): Promise<SubtitleCue[]> {
  return call<SubtitleCue[]>('watch_subtitles', { key, lan, cid })
}

/** 进度条悬停预览：一张切成 columns×rows 的雪碧图 + 每格对应的秒数。 */
export type VideoShots = {
  images: string[]
  index: number[]
  columns: number
  rows: number
  tile_w: number
  tile_h: number
}

export function videoShots(key: string, cid: number): Promise<VideoShots> {
  return call<VideoShots>('video_shots', { key, cid })
}

/** 某个收藏夹里的曲目。 */
export function favTracks(folderId: number, page = 1): Promise<Track[]> {
  return call<Track[]>('fav_tracks', { folder_id: folderId, page })
}

/** 从指定收藏夹移出。 */
export function unfavFrom(key: string, folderId: number): Promise<null> {
  return call<null>('unfav_from', { key, folder_id: folderId })
}

/** 只移除下载记录，不碰磁盘。 */
export function downloadRemoveRecord(key: string): Promise<DownloadView[]> {
  return call<DownloadView[]>('download_remove_record', { key })
}

/** 用户确认后删除本地音频文件，并移除记录。 */
export function downloadDeleteAudio(key: string): Promise<DownloadView[]> {
  return call<DownloadView[]>('download_delete_audio', { key })
}

/** 在文件管理器里定位这个文件。 */
export function downloadReveal(key: string): Promise<null> {
  return call<null>('download_reveal', { key })
}

export function openExternal(url: string): Promise<null> {
  return call<null>('open_external', { url })
}

/** 把播放器截图写到 ~/Pictures/oh-bilibili，返回落盘路径。 */
export function saveScreenshot(png: number[], name: string): Promise<string> {
  return call<string>('save_screenshot', { bytes: png, name })
}

/** 加入或移出稍后再看。 */
export function watchLaterSet(key: string, on: boolean): Promise<null> {
  return call<null>('watch_later_set', { key, on })
}

/** 关注或取关 UP 主。 */
export function followSet(mid: number, on: boolean): Promise<null> {
  return call<null>('follow_set', { mid, on })
}

/** 在文件管理器里打开下载目录。 */
export function downloadOpenDir(): Promise<null> {
  return call<null>('download_open_dir', {})
}

/** 当前账号有没有关注这个 UP 主。 */
export function relationFollowed(mid: number): Promise<boolean> {
  return call<boolean>('relation_followed', { mid })
}

/** 批量查关注状态，顺序与入参一致。 */
export function relationFollowedMany(mids: number[]): Promise<[number, boolean][]> {
  return call<[number, boolean][]>('relation_followed_many', { mids })
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

/** 给一条评论点赞或取消点赞。 */
export function commentLike(key: string, rpid: string, like: boolean): Promise<null> {
  return call<null>('comment_like', { key, rpid, like })
}

/** 点踩 / 取消点踩一条评论。 */
export function commentHate(key: string, rpid: string, hate: boolean): Promise<null> {
  return call<null>('comment_hate', { key, rpid, hate })
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

/** 简介里的站内素材预览：标题、封面与 UP。 */
export function videoBrief(key: string): Promise<Track> {
  return call<Track>('video_brief', { key })
}

/** 这一稿所属的合集目录；没有合集时为 null。 */
export function seasonOf(key: string): Promise<SeasonView | null> {
  return call<SeasonView | null>('season_of', { key })
}

/** 相关推荐。 */
export function related(key: string): Promise<Track[]> {
  return call<Track[]>('related', { key })
}

/** 带颜色的弹幕：时间、文本、十进制 RGB。 */
/** 发一条弹幕，落在 progress_ms 这一刻。 */
/** `mode`：1 滚动、4 底部、5 顶部；`color` 是十进制 RGB。 */
export function danmakuSend(
  key: string,
  text: string,
  progressMs: number,
  mode = 1,
  color = 0xffffff,
  cid?: number,
): Promise<null> {
  return call<null>('danmaku_send', { key, text, progress_ms: progressMs, mode, color, cid })
}

/** 一条弹幕。`mode` 是位置：1 滚动、4 底部、5 顶部。 */
export type DanmakuLine = { secs: number; text: string; color: number; mode: number }

export function danmakuColored(key: string, cid?: number): Promise<DanmakuLine[]> {
  return call<DanmakuLine[]>('danmaku_colored', { key, cid })
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
  return call<PlayerSnapshot>('set_mode', { mode, at_ms: atMs ?? null, key: key ?? null })
}

/** 离开观看页，停掉这条视频的声音。带上 key，换片时旧页面的清理不会掐掉新视频。 */
export function closeWatch(key: string): Promise<PlayerSnapshot> {
  return call<PlayerSnapshot>('close_watch', { key })
}

/** UP 主投稿。返回 (列表, 总数)。`order`：pubdate 最新、click 最多播放、stow 最多收藏。 */
export function spaceVideos(
  mid: number,
  page: number,
  order: 'pubdate' | 'click' | 'stow' = 'pubdate',
): Promise<[Track[], number]> {
  return call<[Track[], number]>('space_videos', { mid, page, order })
}

/** UP 主粉丝与关注数。 */
export function spaceStat(mid: number): Promise<[number, number]> {
  return call<[number, number]>('space_stat', { mid })
}

/** 我关注的人。返回 (列表, 总数)。 */
export function following(page: number): Promise<[Followed[], number]> {
  return call<[Followed[], number]>('following', { page })
}

/** 稍后再看列表。 */
export function watchLaterList(): Promise<Track[]> {
  return call<Track[]>('watch_later_list', {})
}

/** 首页推荐。风控拒绝时返回空列表。 */
export function homeFeed(fresh: number): Promise<Track[]> {
  return call<Track[]>('home_feed', { fresh })
}

export type DynamicItem = {
  id: string
  kind: 'video' | 'opus' | 'forward' | 'article' | 'live'
  mid: number
  author: string
  face: string
  /** 0 个人认证、1 机构认证；null 未认证。 */
  official: number | null
  /** 大会员。 */
  vip: boolean
  pub_time: string
  pub_ts: number
  text: string
  bvid: string
  title: string
  cover: string
  images: string[]
  duration_ms: number | null
  views: number
  danmaku: number
  /** 专栏稿件的 cv 号，kind 为 article 时才有。 */
  article_id?: string
  /** 直播推荐卡片的房间号，kind 为 live 时才有。 */
  room_id?: number
  /** 直播分区名，kind 为 live 时才有。 */
  live_area?: string
  /** 转发动态里被转的那条，只嵌套一层。 */
  orig?: DynamicItem | null
  forwards: number
  comments: number
  likes: number
}

export type DynamicPage = {
  items: DynamicItem[]
  offset: string
  has_more: boolean
}

/** 关注动态。`offset` 是上一页返回的游标。 */
export function dynamicFeed(offset?: string | null): Promise<DynamicPage> {
  return call<DynamicPage>('dynamic_feed', { offset: offset ?? null })
}

export type MessageKind = 'reply' | 'at' | 'like'

export type MessageUser = {
  mid: number
  name: string
  avatar: string
}

export type MessageMention = {
  mid: number
  name: string
}

export type MessageItem = {
  id: string
  kind: MessageKind
  users: MessageUser[]
  title: string
  cover: string | null
  url: string
  bvid: string | null
  quote: string
  at: number
  count: number
  mentions: MessageMention[]
}

export type MessagePage = {
  items: MessageItem[]
  page: number
  has_more: boolean
  next_cursor: string | null
}

export type MessageUnread = {
  reply: number
  at: number
  like: number
  total: number
}

export function messageUnread(): Promise<MessageUnread> {
  return call<MessageUnread>('message_unread', {})
}

export function messages(kind: MessageKind, cursor: string | null, page: number): Promise<MessagePage> {
  return call<MessagePage>('messages', { kind, cursor, page })
}

/** 取一页评论。 */
export function watchComments(key: string, cursor: string | null, hot = true): Promise<CommentPage> {
  return call<CommentPage>('watch_comments', { key, cursor, hot })
}

/** 取一页楼中楼。`root` 是一级评论的 rpid；`cursor` 是上一页的 next，第一页传 null。 */
export function watchReplies(key: string, root: string, cursor: string | null): Promise<CommentPage> {
  return call<CommentPage>('watch_replies', { key, root, cursor })
}

/** 取一页「查看对话」。`root` 是一级评论，`dialog` 是分支里的二级评论。 */
export function watchDialog(
  key: string,
  root: string,
  dialog: string,
  cursor: string | null,
): Promise<CommentPage> {
  return call<CommentPage>('watch_dialog', { key, root, dialog, cursor })
}

/** 热搜榜的一条。`keyword` 是真正要搜的词，`label` 是展示名。 */
export type HotSearchItem = {
  keyword: string
  label: string
  icon: string
  heat: number
}

export function searchSuggest(term: string): Promise<string[]> {
  return call<string[]>('search_suggest', { term })
}

/** 搜索页热搜榜。游客可用；失败时返回空表。 */
export function hotSearch(): Promise<HotSearchItem[]> {
  return call<HotSearchItem[]>('hot_search', {})
}

/** 打开观看页。返回的清单地址指向本机代理，不含任何远端地址。 */
export function watchOpen(key: string, page?: number, resumeAt?: number): Promise<WatchView> {
  return call<WatchView>('watch_open', {
    key,
    page: page ?? null,
    resume_at: resumeAt ?? null,
  })
}

export function authStatus(): Promise<AuthSnapshot> {
  return call<AuthSnapshot>('auth_status', {})
}

/** 离线启动后重新拉一次设备指纹与登录态。 */
export function authRefresh(): Promise<AuthSnapshot> {
  return call<AuthSnapshot>('auth_refresh', {})
}

export function authQrCode(): Promise<QrChallenge> {
  return call<QrChallenge>('auth_qrcode', {})
}

/** 把文本渲染成二维码 SVG。分享面板在本地生成，不走第三方二维码服务。 */
export function qrSvg(text: string): Promise<string> {
  return call<string>('qr_svg', { text })
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

export type SyncOutcome = {
  synced: number
  deferred: number
  rejected: number
  detail: string | null
}

export function syncNow(): Promise<SyncOutcome> {
  return call<SyncOutcome>('sync_now', {})
}
