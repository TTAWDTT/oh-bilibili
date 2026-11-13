//! BiliMusic 的 Tauri 外壳。
//!
//! 这里只做四件事：创建窗口、注册命令、把引擎事件转成前端事件、跑进度心跳。
//! 业务逻辑全在 `bilimusic-core` 里。

mod mv;

use std::sync::Arc;

use bilimusic_core::engine::Engine;
use bilimusic_core::engine::DownloadView;
use bilimusic_core::lyrics::LyricDoc;
use bilimusic_core::wire::{AuthSnapshot, PlayerSnapshot, QueueView, WireError};
use bilimusic_model::{Track, TrackKey};
use serde::Serialize;
use tauri::{Emitter, Manager};

const CHANNEL: &str = "bilimusic://event";

#[derive(Serialize)]
struct Health {
    ok: bool,
    version: &'static str,
    engine: &'static str,
    platform: &'static str,
}

#[derive(Serialize)]
struct PlaylistView {
    id: i64,
    name: String,
}

#[derive(Serialize)]
struct QrView {
    key: String,
    url: String,
    svg: String,
    expires_in_ms: u64,
}

#[derive(Serialize)]
struct QrStatusView {
    state: String,
    auth: AuthSnapshot,
}

/// MV 代理监听的端口，界面用它拼视频地址。
struct MvPort(u16);

#[tauri::command]
fn mv_port(port: tauri::State<'_, MvPort>) -> u16 {
    port.0
}

/// 这条视频的真实弹幕文本。
#[tauri::command(rename_all = "snake_case")]
async fn danmaku(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<Vec<String>, WireError> {
    engine.danmaku(&TrackKey::from_provider(key)).await
}

/// 视频详情元信息。
#[tauri::command(rename_all = "snake_case")]
async fn video_meta(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<bilimusic_core::wire::VideoMetaView, WireError> {
    let m = engine.video_meta(&TrackKey::from_provider(key)).await?;
    Ok(bilimusic_core::wire::VideoMetaView {
        desc: m.desc,
        pubdate: m.pubdate,
        views: m.views,
        danmaku: m.danmaku,
        replies: m.replies,
        favorites: m.favorites,
        coins: m.coins,
        shares: m.shares,
        likes: m.likes,
    })
}

/// 相关推荐。
#[tauri::command(rename_all = "snake_case")]
async fn related(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<Vec<Track>, WireError> {
    engine.related(&TrackKey::from_provider(key)).await
}

/// 带颜色的弹幕。颜色是 B 站用户发弹幕时选的，真实的。
#[tauri::command(rename_all = "snake_case")]
async fn danmaku_colored(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<Vec<(f64, String, u32)>, WireError> {
    engine.danmaku_colored(&TrackKey::from_provider(key)).await
}

/// 弹幕密度曲线，用来画高能进度条。
#[tauri::command(rename_all = "snake_case")]
async fn danmaku_heat(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    buckets: usize,
) -> Result<Vec<u32>, WireError> {
    engine
        .danmaku_heat(&TrackKey::from_provider(key), buckets)
        .await
}

/// 切换看/听。从看到听时把画面当前位置传进来，音频从那里接着放。
#[tauri::command(rename_all = "snake_case")]
async fn set_mode(
    engine: tauri::State<'_, Arc<Engine>>,
    mode: bilimusic_core::wire::PlayMode,
    at_ms: Option<u64>,
    key: Option<String>,
) -> Result<PlayerSnapshot, WireError> {
    let target = key.map(TrackKey::from_provider);
    engine.set_mode(mode, at_ms, target.as_ref()).await
}

/// 离开观看页。看模式下必须停掉声音，否则退出后视频还在后台放。
#[tauri::command(rename_all = "snake_case")]
fn close_watch(
    engine: tauri::State<'_, Arc<Engine>>,
    key: Option<String>,
) -> PlayerSnapshot {
    let key = key.map(|k| TrackKey::from_provider(k));
    engine.close_watch(key.as_ref())
}

/// UP 主投稿。
#[tauri::command(rename_all = "snake_case")]
async fn space_videos(
    engine: tauri::State<'_, Arc<Engine>>,
    mid: u64,
    page: u32,
) -> Result<(Vec<Track>, u32), WireError> {
    engine.space_videos(mid, page).await
}

/// UP 主粉丝与关注数。
#[tauri::command(rename_all = "snake_case")]
async fn space_stat(
    engine: tauri::State<'_, Arc<Engine>>,
    mid: u64,
) -> Result<(u64, u64), WireError> {
    engine.space_stat(mid).await
}

/// 我关注的人。
#[tauri::command(rename_all = "snake_case")]
async fn following(
    engine: tauri::State<'_, Arc<Engine>>,
    page: u32,
) -> Result<(Vec<bilimusic_core::wire::Followed>, u32), WireError> {
    engine.following(page).await
}

/// 稍后再看列表。
#[tauri::command(rename_all = "snake_case")]
async fn watch_later_list(
    engine: tauri::State<'_, Arc<Engine>>,
) -> Result<Vec<bilimusic_model::Track>, WireError> {
    engine.watch_later_list().await
}

/// 首页推荐。
#[tauri::command(rename_all = "snake_case")]
async fn home_feed(
    engine: tauri::State<'_, Arc<Engine>>,
    fresh: u32,
) -> Result<Vec<bilimusic_model::Track>, WireError> {
    engine.home_feed(fresh).await
}

/// 取一页评论。评论区只读，取不到不该挡住看视频。
#[tauri::command(rename_all = "snake_case")]
async fn watch_comments(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    page: u32,
    hot: Option<bool>,
) -> Result<bilimusic_core::wire::CommentPage, WireError> {
    engine
        .comments(&TrackKey::from_provider(key), page, hot.unwrap_or(true))
        .await
}

/// 搜索页热搜榜。拿不到就是空表，界面会用内置建议。
#[tauri::command(rename_all = "snake_case")]
async fn hot_search(engine: tauri::State<'_, Arc<Engine>>) -> Result<Vec<String>, WireError> {
    Ok(engine.hot_search().await)
}

#[tauri::command(rename_all = "snake_case")]
async fn comment_add(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    text: String,
    root: Option<String>,
    parent: Option<String>,
) -> Result<String, WireError> {
    engine
        .comment_add(
            &TrackKey::from_provider(key),
            &text,
            root.as_deref(),
            parent.as_deref(),
        )
        .await
}

#[tauri::command(rename_all = "snake_case")]
async fn comment_del(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    rpid: String,
) -> Result<(), WireError> {
    engine.comment_del(&TrackKey::from_provider(key), &rpid).await
}

/// 打开观看页。一次给齐清单地址与画质档位，前端看不到任何远端地址。
#[tauri::command(rename_all = "snake_case")]
async fn watch_open(
    engine: tauri::State<'_, Arc<Engine>>,
    port: tauri::State<'_, MvPort>,
    key: String,
    page: Option<u32>,
) -> Result<bilimusic_core::wire::WatchView, WireError> {
    let origin = format!("http://127.0.0.1:{}", port.0);
    engine
        .open_watch_page(&TrackKey::from_provider(key), &origin, page)
        .await
}

/// 取一条可播放的 mp4。返回的是本机句柄地址，远端直链不出这一层。
#[tauri::command(rename_all = "snake_case")]
async fn mv_source(
    engine: tauri::State<'_, Arc<Engine>>,
    port: tauri::State<'_, MvPort>,
    key: String,
) -> Result<String, WireError> {
    let remote = engine.mv_url(&TrackKey::from_provider(key)).await?;
    let handle = engine.mint_stream(remote);
    Ok(format!("http://127.0.0.1:{}/m/{}", port.0, handle))
}

#[tauri::command]
fn health() -> Health {
    Health {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
        engine: "tauri",
        platform: std::env::consts::OS,
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn search_q(
    engine: tauri::State<'_, Arc<Engine>>,
    query: String,
    page: u32,
    order: Option<String>,
    partition_ids: Option<Vec<u32>>,
    duration: Option<u32>,
) -> Result<Vec<Track>, WireError> {
    use bilimusic_model::SearchOrder;
    let order = match order.as_deref() {
        Some("click") => SearchOrder::Click,
        Some("pubdate") => SearchOrder::PubDate,
        Some("danmaku") => SearchOrder::Danmaku,
        _ => SearchOrder::TotalRank,
    };
    // 传一级分区 id 时直接用 B 站的 tids 参数，返回该分区下的全部结果；
    // 不传则全站搜索。原来拿 4 页再按 typeid 筛的做法已经不需要了。
    let tid = partition_ids.as_ref().and_then(|ids| ids.first().copied());
    engine
        .search_scoped(&query, page, order, tid, duration)
        .await
}

#[tauri::command]
fn player_state(engine: tauri::State<'_, Arc<Engine>>) -> PlayerSnapshot {
    engine.snapshot()
}

#[tauri::command(rename_all = "snake_case")]
async fn player_play(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<PlayerSnapshot, WireError> {
    let arc = engine.inner().clone();
    arc.play_key(&TrackKey::from_provider(key)).await
}

#[tauri::command(rename_all = "snake_case")]
async fn player_play_context(
    engine: tauri::State<'_, Arc<Engine>>,
    keys: Vec<String>,
    index: usize,
) -> Result<PlayerSnapshot, WireError> {
    let arc = engine.inner().clone();
    arc.play_context(&keys, index).await
}

#[tauri::command]
async fn player_toggle(
    engine: tauri::State<'_, Arc<Engine>>,
) -> Result<PlayerSnapshot, WireError> {
    let arc = engine.inner().clone();
    arc.toggle_or_load().await
}

#[tauri::command(rename_all = "snake_case")]
async fn player_next(
    engine: tauri::State<'_, Arc<Engine>>,
) -> Result<PlayerSnapshot, WireError> {
    let arc = engine.inner().clone();
    arc.next().await
}

#[tauri::command(rename_all = "snake_case")]
async fn player_prev(
    engine: tauri::State<'_, Arc<Engine>>,
) -> Result<PlayerSnapshot, WireError> {
    let arc = engine.inner().clone();
    arc.prev().await
}

#[tauri::command(rename_all = "snake_case")]
fn player_seek(engine: tauri::State<'_, Arc<Engine>>, position_ms: u64) -> PlayerSnapshot {
    engine.seek(position_ms)
}

#[tauri::command(rename_all = "snake_case")]
fn player_speed(engine: tauri::State<'_, Arc<Engine>>, speed: f32) -> PlayerSnapshot {
    engine.set_speed(speed)
}

#[tauri::command(rename_all = "snake_case")]
fn player_volume(engine: tauri::State<'_, Arc<Engine>>, volume: f32) -> PlayerSnapshot {
    engine.set_volume(volume)
}

#[tauri::command(rename_all = "snake_case")]
fn player_repeat(engine: tauri::State<'_, Arc<Engine>>, mode: String) -> PlayerSnapshot {
    engine.set_repeat(&mode)
}

#[tauri::command(rename_all = "snake_case")]
fn player_shuffle(engine: tauri::State<'_, Arc<Engine>>, on: bool) -> PlayerSnapshot {
    engine.set_shuffle(on)
}

#[tauri::command(rename_all = "snake_case")]
fn queue_state(engine: tauri::State<'_, Arc<Engine>>) -> QueueView {
    engine.queue_view()
}

/// 队列恢复进度 (已补, 总数)。没有在恢复时返回 null。
#[tauri::command(rename_all = "snake_case")]
fn queue_remove(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<QueueView, WireError> {
    engine.queue_remove(&key)
}

#[tauri::command(rename_all = "snake_case")]
fn queue_clear(engine: tauri::State<'_, Arc<Engine>>) -> Result<QueueView, WireError> {
    engine.queue_clear()
}

#[tauri::command(rename_all = "snake_case")]
fn queue_restore_progress(engine: tauri::State<'_, Arc<Engine>>) -> Option<(usize, usize)> {
    engine.queue_restore_progress()
}

#[tauri::command(rename_all = "snake_case")]
fn queue_move(
    engine: tauri::State<'_, Arc<Engine>>,
    from: String,
    to: String,
) -> Result<QueueView, WireError> {
    engine.queue_move(&from, &to)
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct HistoryEntryView {
    track: Track,
    /// 播放时刻，Unix 毫秒。
    played_at: i64,
    /// 上次看到的位置，毫秒。历史卡片底下的进度条用它。
    position_ms: u64,
}

#[tauri::command(rename_all = "snake_case")]
fn history_delete(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<(), WireError> {
    engine.history_delete(&key)
}

#[tauri::command(rename_all = "snake_case")]
fn history_clear(engine: tauri::State<'_, Arc<Engine>>) -> Result<(), WireError> {
    engine.history_clear()
}

#[tauri::command(rename_all = "snake_case")]
fn library_history_timed(
    engine: tauri::State<'_, Arc<Engine>>,
    limit: u32,
) -> Result<Vec<HistoryEntryView>, WireError> {
    Ok(engine
        .history_with_time(limit)?
        .into_iter()
        .map(|(track, played_at, position_ms)| HistoryEntryView {
            track,
            played_at,
            position_ms,
        })
        .collect())
}

#[tauri::command(rename_all = "snake_case")]
fn library_history(
    engine: tauri::State<'_, Arc<Engine>>,
    limit: u32,
) -> Result<Vec<Track>, WireError> {
    engine.history(limit)
}

#[tauri::command(rename_all = "snake_case")]
fn library_playlists(engine: tauri::State<'_, Arc<Engine>>) -> Result<Vec<PlaylistView>, WireError> {
    Ok(engine
        .playlists()?
        .into_iter()
        .map(|p| PlaylistView { id: p.id, name: p.name })
        .collect())
}

#[tauri::command(rename_all = "snake_case")]
fn library_create(
    engine: tauri::State<'_, Arc<Engine>>,
    name: String,
) -> Result<PlaylistView, WireError> {
    let p = engine.create_playlist(&name)?;
    Ok(PlaylistView { id: p.id, name: p.name })
}

#[tauri::command(rename_all = "snake_case")]
fn library_add(
    engine: tauri::State<'_, Arc<Engine>>,
    playlist_id: i64,
    key: String,
) -> Result<(), WireError> {
    engine.add_to_playlist(playlist_id, &TrackKey::from_provider(key))
}

#[tauri::command(rename_all = "snake_case")]
fn library_tracks(
    engine: tauri::State<'_, Arc<Engine>>,
    playlist_id: i64,
) -> Result<Vec<Track>, WireError> {
    engine.playlist_tracks(playlist_id)
}

#[tauri::command(rename_all = "snake_case")]
async fn like_set(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    liked: bool,
) -> Result<(), WireError> {
    engine.like_set(&TrackKey::from_provider(key), liked).await
}

#[tauri::command(rename_all = "snake_case")]
async fn relation_states(
    engine: tauri::State<'_, Arc<Engine>>,
    keys: Vec<String>,
) -> Result<Vec<(String, bool, bool, u32)>, WireError> {
    engine.relation_states(keys).await
}

#[tauri::command(rename_all = "snake_case")]
async fn coin_set(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    count: u8,
    also_like: bool,
) -> Result<(), WireError> {
    engine
        .coin_set(&TrackKey::from_provider(key), count, also_like)
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct AuthorCardView {
    name: String,
    face: String,
    fans: u64,
    sign: String,
    official: Option<String>,
    level: u8,
    videos: u64,
    likes: u64,
}

#[tauri::command(rename_all = "snake_case")]
async fn author_card(
    engine: tauri::State<'_, Arc<Engine>>,
    mid: u64,
) -> Result<AuthorCardView, WireError> {
    let c = engine.author_card(mid).await?;
    Ok(AuthorCardView {
        name: c.name,
        face: c.face,
        fans: c.fans,
        sign: c.sign,
        official: c.official,
        level: c.level,
        videos: c.videos,
        likes: c.likes,
    })
}

#[derive(Serialize)]
struct FavFolderView {
    id: i64,
    title: String,
    count: u32,
    cover: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
async fn fav_folders(
    engine: tauri::State<'_, Arc<Engine>>,
) -> Result<Vec<FavFolderView>, WireError> {
    Ok(engine
        .fav_folders()
        .await?
        .into_iter()
        .map(|f| FavFolderView {
            id: f.id,
            title: f.title,
            count: f.count,
            cover: f.cover,
        })
        .collect())
}

#[tauri::command(rename_all = "snake_case")]
async fn fav_covers(
    engine: tauri::State<'_, Arc<Engine>>,
    folder_id: i64,
    limit: u32,
) -> Result<Vec<String>, WireError> {
    engine.fav_covers(folder_id, limit).await
}

#[tauri::command(rename_all = "snake_case")]
async fn video_online(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    cid: u64,
) -> Result<u64, WireError> {
    engine.online_count(&TrackKey::from_provider(key), cid).await
}

#[tauri::command(rename_all = "snake_case")]
async fn ranking(engine: tauri::State<'_, Arc<Engine>>, rid: u32) -> Result<Vec<Track>, WireError> {
    engine.ranking(rid).await
}

#[derive(Serialize)]
struct UserHitView {
    mid: u64,
    name: String,
    face: Option<String>,
    fans: u64,
    videos: u64,
    sign: String,
    level: u8,
}

#[tauri::command(rename_all = "snake_case")]
async fn search_users(
    engine: tauri::State<'_, Arc<Engine>>,
    keyword: String,
    page: u32,
) -> Result<Vec<UserHitView>, WireError> {
    Ok(engine
        .search_users(&keyword, page)
        .await?
        .into_iter()
        .map(|u| UserHitView {
            mid: u.mid,
            name: u.name,
            face: u.face,
            fans: u.fans,
            videos: u.videos,
            sign: u.sign,
            level: u.level,
        })
        .collect())
}

#[tauri::command(rename_all = "snake_case")]
async fn comment_emotes(
    engine: tauri::State<'_, Arc<Engine>>,
) -> Result<Vec<(String, String)>, WireError> {
    engine.comment_emotes().await
}

#[tauri::command(rename_all = "snake_case")]
async fn video_tags(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<Vec<String>, WireError> {
    engine.video_tags(&TrackKey::from_provider(key)).await
}

#[tauri::command(rename_all = "snake_case")]
async fn liked_videos(engine: tauri::State<'_, Arc<Engine>>) -> Result<Vec<Track>, WireError> {
    engine.liked_videos().await
}

#[tauri::command(rename_all = "snake_case")]
async fn unfav_from(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    folder_id: i64,
) -> Result<(), WireError> {
    engine
        .unfav_from(&TrackKey::from_provider(key), folder_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
async fn fav_tracks(
    engine: tauri::State<'_, Arc<Engine>>,
    folder_id: i64,
    page: u32,
) -> Result<Vec<Track>, WireError> {
    engine.fav_tracks(folder_id, page).await
}

#[tauri::command(rename_all = "snake_case")]
async fn watch_later_set(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    on: bool,
) -> Result<(), WireError> {
    engine
        .watch_later_set(&TrackKey::from_provider(key), on)
        .await
}

#[tauri::command(rename_all = "snake_case")]
async fn follow_set(
    engine: tauri::State<'_, Arc<Engine>>,
    mid: u64,
    on: bool,
) -> Result<(), WireError> {
    engine.follow_set(mid, on).await
}

#[tauri::command(rename_all = "snake_case")]
async fn relation_followed(
    engine: tauri::State<'_, Arc<Engine>>,
    mid: u64,
) -> Result<bool, WireError> {
    engine.is_following(mid).await
}

#[tauri::command(rename_all = "snake_case")]
async fn fav_set(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    faved: bool,
    folder_id: Option<i64>,
) -> Result<(), WireError> {
    engine
        .fav_set(&TrackKey::from_provider(key), faved, folder_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
async fn lyrics_get(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<LyricDoc, WireError> {
    engine.lyrics_get(&TrackKey::from_provider(key)).await
}

#[tauri::command(rename_all = "snake_case")]
fn auth_status(engine: tauri::State<'_, Arc<Engine>>) -> AuthSnapshot {
    engine.auth()
}

#[tauri::command(rename_all = "snake_case")]
async fn auth_qrcode(engine: tauri::State<'_, Arc<Engine>>) -> Result<QrView, WireError> {
    let qr = engine.auth_qrcode().await?;
    Ok(QrView {
        key: qr.key,
        url: qr.url,
        svg: qr.svg,
        expires_in_ms: 180_000,
    })
}

#[tauri::command(rename_all = "snake_case")]
async fn auth_poll(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<QrStatusView, WireError> {
    let (state, auth) = engine.auth_poll(&key).await?;
    Ok(QrStatusView { state, auth })
}

#[tauri::command(rename_all = "snake_case")]
async fn auth_logout(engine: tauri::State<'_, Arc<Engine>>) -> Result<AuthSnapshot, WireError> {
    Ok(engine.auth_logout().await)
}

#[tauri::command(rename_all = "snake_case")]
async fn danmaku_send(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    text: String,
    progress_ms: u64,
) -> Result<(), WireError> {
    engine
        .danmaku_send(&TrackKey::from_provider(key), &text, progress_ms)
        .await
}

#[tauri::command(rename_all = "snake_case")]
fn download_remove(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<Vec<DownloadView>, WireError> {
    engine.download_remove(&key)
}

/// 在系统文件管理器里定位这个文件。路径来自下载记录，不接受前端传任意路径。
#[tauri::command(rename_all = "snake_case")]
fn download_reveal(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<(), WireError> {
    let path = engine
        .downloads()
        .into_iter()
        .find(|d| d.key == key)
        .and_then(|d| d.path)
        .ok_or_else(|| WireError::input("key", "这条记录还没有落盘路径"))?;
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| WireError::internal(format!("打不开访达：{e}")))?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn downloads_list(engine: tauri::State<'_, Arc<Engine>>) -> Vec<DownloadView> {
    engine
        .downloads()
        .into_iter()
        .map(|d| DownloadView {
            key: d.key,
            title: d.title,
            state: d.state,
            progress: d.progress,
            path: d.path,
        })
        .collect()
}

#[tauri::command(rename_all = "snake_case")]
async fn download_enqueue(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<DownloadView, WireError> {
    let arc = engine.inner().clone();
    let view = arc.enqueue_download(&TrackKey::from_provider(key)).await?;
    Ok(DownloadView {
        key: view.key,
        title: view.title,
        state: view.state,
        progress: view.progress,
        path: view.path,
    })
}

#[tauri::command(rename_all = "snake_case")]
async fn sync_now(engine: tauri::State<'_, Arc<Engine>>) -> Result<(), WireError> {
    let arc = engine.inner().clone();
    arc.sync_now().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&dir).ok();
            let db_path = dir.join("library.sqlite");

            let engine = Engine::new(&db_path)?;
            mv::apply_env_failures();
            let mv_port = mv::spawn(engine.cookie_header(), engine.clone())
                .map_err(|e| format!("MV 代理起不来：{e}"))?;
            app.manage(MvPort(mv_port));
            app.manage(engine.clone());

            // 引擎事件 -> 前端事件。全应用只有这一处 emit。
            let handle = app.handle().clone();
            let mut rx = engine.subscribe();
            tauri::async_runtime::spawn(async move {
                while let Ok(event) = rx.recv().await {
                    let _ = handle.emit(CHANNEL, &event);
                }
            });

            // 进度心跳。只有真的在播才发，避免空转。
            let ticker = engine.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(200));
                ticker.emit_progress();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            mv_port,
            danmaku,
            danmaku_colored,
            danmaku_heat,
            related,
            video_meta,
            mv_source,
            watch_open,
            watch_comments,
            hot_search,
            comment_add,
            comment_del,
            home_feed,
            watch_later_list,
            following,
            space_videos,
            space_stat,
            set_mode,
            close_watch,
            search_q,
            player_state,
            player_play,
            player_play_context,
            player_toggle,
            player_next,
            player_prev,
            player_seek,
            player_volume,
            player_speed,
            player_repeat,
            player_shuffle,
            queue_state,
            queue_move,
            queue_remove,
            queue_clear,
            queue_restore_progress,
            library_history,
            library_history_timed,
            history_delete,
            history_clear,
            library_playlists,
            library_create,
            library_add,
            library_tracks,
            like_set,
            coin_set,
            relation_states,
            follow_set,
            relation_followed,
            watch_later_set,
            fav_folders,
            fav_covers,
            liked_videos,
            video_tags,
            comment_emotes,
            search_users,
            ranking,
            video_online,
            author_card,
            fav_tracks,
            unfav_from,
            fav_set,
            lyrics_get,
            auth_status,
            auth_qrcode,
            auth_poll,
            auth_logout,
            downloads_list,
            danmaku_send,
            download_remove,
            download_reveal,
            download_enqueue,
            sync_now,
        ])
        .run(tauri::generate_context!())
        .expect("BiliMusic 启动失败");
}
