//! BiliMusic 的 Tauri 外壳。
//!
//! 这里只做四件事：创建窗口、注册命令、把引擎事件转成前端事件、跑进度心跳。
//! 业务逻辑全在 `bilimusic-core` 里。

mod mv;

use std::sync::Arc;

use bilimusic_core::engine::Engine;
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

#[derive(Serialize)]
struct DownloadView {
    key: String,
    title: String,
    state: String,
    progress: f32,
    path: Option<String>,
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

/// 取一条可播放的 mp4 直链；界面会把它交给本地代理转发。
#[tauri::command(rename_all = "snake_case")]
async fn mv_source(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
) -> Result<String, WireError> {
    engine.mv_url(&TrackKey::from_provider(key)).await
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
) -> Result<Vec<Track>, WireError> {
    engine.search(&query, page).await
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
fn player_toggle(engine: tauri::State<'_, Arc<Engine>>) -> PlayerSnapshot {
    engine.toggle()
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
async fn fav_set(
    engine: tauri::State<'_, Arc<Engine>>,
    key: String,
    faved: bool,
) -> Result<(), WireError> {
    engine.fav_set(&TrackKey::from_provider(key), faved).await
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
            let mv_port = mv::spawn(engine.cookie_header())
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
            mv_source,
            search_q,
            player_state,
            player_play,
            player_play_context,
            player_toggle,
            player_next,
            player_prev,
            player_seek,
            player_volume,
            player_repeat,
            player_shuffle,
            queue_state,
            library_playlists,
            library_create,
            library_add,
            library_tracks,
            like_set,
            fav_set,
            lyrics_get,
            auth_status,
            auth_qrcode,
            auth_poll,
            auth_logout,
            downloads_list,
            download_enqueue,
            sync_now,
        ])
        .run(tauri::generate_context!())
        .expect("BiliMusic 启动失败");
}
