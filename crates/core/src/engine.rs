//! 编排层：把 B 站、曲库、声卡、歌词缝成 UI 能用的命令面。
//!
//! 三条纪律：
//! 1. 扛锁绝不跨 await，所以每个锁都在 await 之前释放。
//! 2. 后台变化发事件，命令成功直接返回结果，UI 不用猜。
//! 3. 位置只有声卡一个真值，快照是读出来的投影。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use bilimusic_audio::{Media, Player};
use bilimusic_bili::media::RemoteMedia;
use bilimusic_bili::Source;
use bilimusic_model::{Millis, Quality, SearchQuery, Track, TrackKey};
use bilimusic_store::{Library, ReactionKind, ReactionState};

use crate::lyrics::{self, LyricDoc};
use crate::state::{LoadToken, PlayerState, Prepared, Queue};
use crate::wire::{AppEvent, AuthSnapshot, AuthUser, PlayerSnapshot, QueueView, WireError};

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadView {
    pub key: String,
    pub title: String,
    pub state: String,
    pub progress: f32,
    pub path: Option<String>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct Engine {
    /// 登录 cookie 的落盘位置。凭据只在本机，不上传任何地方。
    cookie_file: std::path::PathBuf,
    source: Source,
    library: Library,
    player: Mutex<Player>,
    queue: Mutex<Queue>,
    state: Mutex<PlayerState>,
    known: Mutex<HashMap<String, Track>>,
    lyrics_cache: Mutex<HashMap<String, LyricDoc>>,
    token: AtomicU64,
    volume: Mutex<f32>,
    repeat: Mutex<String>,
    events: tokio::sync::broadcast::Sender<AppEvent>,
    http: reqwest::Client,
    downloads: Mutex<Vec<DownloadView>>,
}

impl Engine {
    pub fn new(db_path: &std::path::Path) -> Result<Arc<Engine>, WireError> {
        let mut source = tauri_runtime::block_on_bili()?;
        // 启动时把上次的登录态装回去，否则每次重开都要重新扫码。
        let cookie_file = db_path.with_file_name("cookies.json");
        if let Ok(raw) = std::fs::read_to_string(&cookie_file) {
            if let Ok(pairs) = serde_json::from_str::<Vec<(String, String)>>(&raw) {
                source.import_cookies(&pairs);
                let _ = tauri_runtime::block_on_nav(&source);
            }
        }
        let library = Library::open(db_path)?;
        let player = Player::start().map_err(|e| WireError::internal(e.to_string()))?;
        let (events, _) = tokio::sync::broadcast::channel(256);
        Ok(Arc::new(Engine {
            cookie_file,
            source,
            library,
            player: Mutex::new(player),
            queue: Mutex::new(Queue::default()),
            state: Mutex::new(PlayerState::Idle),
            known: Mutex::new(HashMap::new()),
            lyrics_cache: Mutex::new(HashMap::new()),
            token: AtomicU64::new(0),
            volume: Mutex::new(0.7),
            repeat: Mutex::new("off".into()),
            events,
            http: reqwest::Client::new(),
            downloads: Mutex::new(Vec::new()),
        }))
    }

    /// 进度心跳。只在真的在播时发，UI 不用自己算时间。
    pub fn emit_progress(&self) {
        let snap = self.snapshot();
        if snap.phase == "playing" {
            self.emit(AppEvent::Progress {
                position_ms: snap.position_ms,
                duration_ms: snap.duration_ms,
                level: lock(&self.player).clock().level(),
            });
        }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AppEvent> {
        self.events.subscribe()
    }

    fn emit(&self, event: AppEvent) {
        let _ = self.events.send(event);
    }

    fn remember(&self, track: &Track) {
        lock(&self.known).insert(track.key.as_opaque().to_string(), track.clone());
    }

    fn track_of(&self, key: &TrackKey) -> Result<Track, WireError> {
        if let Some(t) = lock(&self.known).get(key.as_opaque()).cloned() {
            return Ok(t);
        }
        if let Some(t) = self.library.track_by_key(key)? {
            return Ok(t);
        }
        Err(WireError::input("key", "这个键还没有对应的曲目"))
    }

    fn next_token(&self) -> LoadToken {
        LoadToken(self.token.fetch_add(1, Ordering::SeqCst) + 1)
    }

    pub async fn search(&self, query: &str, page: u32) -> Result<Vec<Track>, WireError> {
        let q = SearchQuery::parse(query, page)
            .map_err(|e| WireError::input("query", e.to_string()))?;
        let tracks = self.source.search(&q).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    /// 播放一首，或换到某一首。取流失败会落进 Faulted 并发 notice。
    pub async fn play_key(self: &Arc<Self>, key: &TrackKey) -> Result<PlayerSnapshot, WireError> {
        let token = self.next_token();
        {
            let mut st = lock(&self.state);
            *st = std::mem::replace(&mut *st, PlayerState::Idle).begin_load(token, key.clone());
        }
        self.queue.lock().unwrap_or_else(|e| e.into_inner()).jump_by_key(key);
        let track = self.track_of(key)?;
        self.emit(AppEvent::Buffering {
            track: track.clone(),
        });

        match self.fetch_and_load(key, token).await {
            Ok(prepared) => {
                let mut st = lock(&self.state);
                *st = std::mem::replace(&mut *st, PlayerState::Idle).stream_ready(token, prepared);
                drop(st);
                self.library
                    .upsert_track(&self.track_of(key)?)
                    .map_err(WireError::from)?;
                self.emit(AppEvent::NowPlaying {
                    track: self.track_of(key)?,
                    index: self.queue.lock().ok().and_then(|q| q.index()),
                });
                Ok(self.snapshot())
            }
            Err(err) => {
                let mut st = lock(&self.state);
                *st = std::mem::replace(&mut *st, PlayerState::Idle)
                    .fail(crate::state::Fault::Network(err.message().to_string()));
                drop(st);
                self.emit(AppEvent::Notice {
                    error: err.clone(),
                    op: "play".into(),
                });
                Err(err)
            }
        }
    }

    async fn fetch_and_load(
        &self,
        key: &TrackKey,
        token: LoadToken,
    ) -> Result<Prepared, WireError> {
        let detail = self.source.detail(key).await?;
        let streams = self.source.streams(&detail).await?;
        let best = streams.first().ok_or_else(|| WireError::internal("没有可用音轨"))?;
        // 阻塞 HTTP 客户端必须在阻塞线程池里建，否则它的内部 runtime 会在
        // async 上下文里被丢弃，直接 panic。
        let url = best.url.clone();
        let headers = self.source.stream_headers();
        let media = tokio::task::spawn_blocking(move || RemoteMedia::open(url, headers))
            .await
            .map_err(|e| WireError::internal(e.to_string()))?
            .map_err(WireError::internal)?;
        {
            let player = lock(&self.player);
            player.load(Media::new(media)).map_err(|e| WireError::internal(e.to_string()))?;
            player.set_volume(*lock(&self.volume));
            player.seek(0);
        }
        let _ = token;
        let quality: Quality = best.quality;
        Ok(Prepared {
            quality,
            duration: detail.track.duration.unwrap_or(Millis(0)),
        })
    }

    pub async fn play_context(
        self: &Arc<Self>,
        keys: &[String],
        index: usize,
    ) -> Result<PlayerSnapshot, WireError> {
        let tracks: Vec<Track> = keys
            .iter()
            .filter_map(|k| lock(&self.known).get(k).cloned())
            .collect();
        if tracks.is_empty() {
            return Err(WireError::input("keys", "队列是空的"));
        }
        let start = index.min(tracks.len() - 1);
        let key = tracks
            .get(start)
            .map(|t| t.key.clone())
            .ok_or_else(|| WireError::input("index", "越界"))?;
        {
            let mut q = lock(&self.queue);
            *q = Queue::from_tracks(&tracks, start);
        }
        self.play_key(&key).await
    }

    pub fn toggle(&self) -> PlayerSnapshot {
        let is_playing = lock(&self.player).clock().is_playing();
        {
            let player = lock(&self.player);
            if is_playing {
                player.pause();
            } else {
                player.play();
            }
        }
        {
            let mut st = lock(&self.state);
            let current = std::mem::replace(&mut *st, PlayerState::Idle);
            *st = if is_playing { current.pause() } else { current.play() };
        }
        self.snapshot()
    }

    pub async fn next(self: &Arc<Self>) -> Result<PlayerSnapshot, WireError> {
        // 单曲循环：播完重放同一首，而不是走到下一首。
        if *lock(&self.repeat) == "one" {
            let current = lock(&self.queue).current().map(|e| e.track.key.clone());
            if let Some(key) = current {
                return self.play_key(&key).await;
            }
        }
        let wrapped = *lock(&self.repeat) == "all";
        let next_key = {
            let mut q = lock(&self.queue);
            q.advance(wrapped).map(|e| e.track.key.clone())
        };
        match next_key {
            Some(k) => self.play_key(&k).await,
            None => {
                {
                    let player = lock(&self.player);
                    player.pause();
                }
                self.emit(AppEvent::Stopped);
                Ok(self.snapshot())
            }
        }
    }

    pub async fn prev(self: &Arc<Self>) -> Result<PlayerSnapshot, WireError> {
        let prev_key = {
            let mut q = lock(&self.queue);
            q.retreat().map(|e| e.track.key.clone())
        };
        match prev_key {
            Some(k) => self.play_key(&k).await,
            None => Ok(self.snapshot()),
        }
    }

    pub fn seek(&self, position_ms: u64) -> PlayerSnapshot {
        lock(&self.player).seek(position_ms);
        self.snapshot()
    }

    pub fn set_volume(&self, volume: f32) -> PlayerSnapshot {
        let v = volume.clamp(0.0, 1.0);
        *lock(&self.volume) = v;
        lock(&self.player).set_volume(v);
        self.snapshot()
    }

    pub fn set_repeat(&self, mode: &str) -> PlayerSnapshot {
        let normalized = match mode {
            "all" | "one" => mode,
            _ => "off",
        };
        *lock(&self.repeat) = normalized.to_string();
        self.snapshot()
    }

    pub fn set_shuffle(&self, on: bool) -> PlayerSnapshot {
        lock(&self.queue).set_shuffle(on);
        self.snapshot()
    }

    pub fn snapshot(&self) -> PlayerSnapshot {
        let state = lock(&self.state).clone();
        let (position_ms, duration_ms) = {
            let player = lock(&self.player);
            let clock = player.clock();
            (clock.position_ms(), clock.sample_rate())
        };
        let track = state.track().and_then(|k| lock(&self.known).get(k.as_opaque()).cloned());
        let quality = state.prepared().map(|p| p.quality.kbps());
        let _ = duration_ms;
        PlayerSnapshot {
            phase: state.phase().to_string(),
            duration_ms: track.as_ref().and_then(|t| t.duration).map(|d| d.0).unwrap_or(0),
            track,
            position_ms,
            volume: *lock(&self.volume),
            repeat: lock(&self.repeat).clone(),
            shuffle: lock(&self.queue).shuffle(),
            quality_kbps: quality,
        }
    }

    pub fn queue_view(&self) -> QueueView {
        let q = lock(&self.queue);
        QueueView {
            items: q.items(),
            index: q.index(),
        }
    }

    pub fn playlists(&self) -> Result<Vec<bilimusic_store::Playlist>, WireError> {
        Ok(self.library.playlists()?)
    }

    pub fn create_playlist(&self, name: &str) -> Result<bilimusic_store::Playlist, WireError> {
        Ok(self.library.create_playlist(name)?)
    }

    pub fn add_to_playlist(&self, playlist_id: i64, key: &TrackKey) -> Result<(), WireError> {
        let track = self.track_of(key)?;
        let id = self.library.upsert_track(&track)?;
        self.library.add_to_playlist(playlist_id, id)?;
        self.emit(AppEvent::LibraryChanged);
        Ok(())
    }

    pub fn playlist_tracks(&self, playlist_id: i64) -> Result<Vec<Track>, WireError> {
        Ok(self.library.playlist_tracks(playlist_id)?)
    }

    pub async fn like_set(&self, key: &TrackKey, liked: bool) -> Result<(), WireError> {
        self.source.set_like(key, liked).await?;
        if let Some(t) = lock(&self.known).get(key.as_opaque()).cloned() {
            let id = self.library.upsert_track(&t)?;
            if let Some(mid) = self.source.nav().mid {
                self.library.set_reaction(id, mid, ReactionKind::Like, liked)?;
                let reactions = self.library.pending_reactions(mid, 50)?;
                if let Some(r) = reactions.iter().find(|r| r.track_id == id && r.kind == ReactionKind::Like) {
                    self.library.mark_reaction(r, ReactionState::Synced)?;
                }
            }
        }
        Ok(())
    }

    pub async fn fav_set(&self, key: &TrackKey, faved: bool) -> Result<(), WireError> {
        self.source.set_favorite(key, faved).await?;
        if let Some(t) = lock(&self.known).get(key.as_opaque()).cloned() {
            let id = self.library.upsert_track(&t)?;
            if let Some(mid) = self.source.nav().mid {
                self.library.set_reaction(id, mid, ReactionKind::Fav, faved)?;
                let pending = self.library.pending_reactions(mid, 50)?;
                if let Some(r) = pending
                    .iter()
                    .find(|r| r.track_id == id && r.kind == ReactionKind::Fav)
                {
                    self.library.mark_reaction(r, ReactionState::Synced)?;
                }
            }
        }
        Ok(())
    }

    pub async fn lyrics_get(&self, key: &TrackKey) -> Result<LyricDoc, WireError> {
        if let Some(doc) = lock(&self.lyrics_cache).get(key.as_opaque()).cloned() {
            return Ok(doc);
        }
        let track = self.track_of(key)?;
        // 两级回退：本地 lrc 优先（用户自己放的更准），再打 lrclib。
        // B 站字幕那一级还没接，README 已写明。
        let doc = match lyrics::from_local(&track) {
            Some(doc) => doc,
            None => match lyrics::from_lrclib(&self.http, &track).await {
                Some(doc) => doc,
                None => match self.source.subtitles(key).await {
                    Ok(lines) if !lines.is_empty() => LyricDoc {
                        synced: true,
                        source: "bilibili-subtitle".into(),
                        lines: lines
                            .into_iter()
                            .map(|(at_ms, text)| crate::lyrics::LyricLine { at_ms, text })
                            .collect(),
                    },
                    _ => LyricDoc::empty(),
                },
            },
        };
        lock(&self.lyrics_cache).insert(key.as_opaque().to_string(), doc.clone());
        Ok(doc)
    }

    pub fn auth(&self) -> AuthSnapshot {
        let nav = self.source.nav();
        AuthSnapshot {
            logged_in: nav.is_login,
            user: nav.mid.map(|mid| AuthUser {
                mid,
                uname: nav.uname.unwrap_or_default(),
                avatar: nav.avatar,
            }),
        }
    }

    /// 把当前 cookie 写进应用数据目录。含登录令牌，只存本机。
    fn persist_cookies(&self) {
        let pairs = self.source.export_cookies();
        if let Ok(json) = serde_json::to_string(&pairs) {
            let _ = std::fs::write(&self.cookie_file, json);
        }
    }

    pub fn cookie_header(&self) -> String {
        self.source.cookie_header()
    }

    pub async fn mv_url(&self, key: &TrackKey) -> Result<String, WireError> {
        Ok(self.source.mv_url(key).await?)
    }

    pub async fn auth_qrcode(&self) -> Result<bilimusic_bili::auth::QrChallenge, WireError> {
        Ok(self.source.login_qr().await?)
    }

    pub async fn auth_poll(&self, key: &str) -> Result<(String, AuthSnapshot), WireError> {
        use bilimusic_bili::auth::QrStatus;
        let status = self.source.poll_qr(key).await?;
        let label = match status {
            QrStatus::Waiting => "waiting",
            QrStatus::Scanned => "scanned",
            QrStatus::Confirmed => "confirmed",
            QrStatus::Expired => "expired",
        };
        let auth = self.auth();
        if status == QrStatus::Confirmed {
            self.persist_cookies();
            self.emit(AppEvent::AuthChanged { auth: auth.clone() });
        }
        Ok((label.to_string(), auth))
    }

    pub async fn auth_logout(&self) -> AuthSnapshot {
        self.source.logout().await;
        let _ = std::fs::remove_file(&self.cookie_file);
        self.emit(AppEvent::AuthChanged {
            auth: self.auth(),
        });
        self.auth()
    }

    pub fn downloads(&self) -> Vec<DownloadView> {
        lock(&self.downloads).clone()
    }

    /// 用 yt-dlp 把一首歌落到本地。任务在后台跑，进度靠事件与轮询列表两种方式看。
    pub async fn enqueue_download(
        self: &Arc<Self>,
        key: &TrackKey,
    ) -> Result<DownloadView, WireError> {
        let track = self.track_of(key)?;
        let bin = find_ytdlp().ok_or_else(|| {
            WireError::internal("找不到 yt-dlp，先运行 scripts/fetch-yt-dlp.sh")
        })?;

        let view = DownloadView {
            key: key.as_opaque().to_string(),
            title: track.title.clone(),
            state: "running".into(),
            progress: 0.0,
            path: None,
        };
        {
            let mut list = lock(&self.downloads);
            list.retain(|d| d.key != view.key);
            list.push(view.clone());
        }
        self.emit(AppEvent::Download {
            view: serde_json::to_value(&view).unwrap_or(serde_json::Value::Null),
        });

        let dir = download_dir();
        std::fs::create_dir_all(&dir).ok();
        let url = format!("https://www.bilibili.com/video/{}", key.as_opaque());
        let template = dir.join("%(title)s.%(ext)s");
        let engine = self.clone();
        let view_key = view.key.clone();

        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new(&bin)
                .arg("--no-playlist")
                .arg("-f")
                .arg("ba")
                .arg("-o")
                .arg(&template)
                .arg(&url)
                .output();

            let (state, path) = match output {
                Ok(out) if out.status.success() => ("done", newest_file(&dir)),
                Ok(out) => {
                    eprintln!(
                        "yt-dlp 失败: {}",
                        String::from_utf8_lossy(&out.stderr).chars().take(400).collect::<String>()
                    );
                    ("failed", None)
                }
                Err(e) => {
                    eprintln!("起不动 yt-dlp: {e}");
                    ("failed", None)
                }
            };
            let mut list = lock(&engine.downloads);
            if let Some(item) = list.iter_mut().find(|d| d.key == view_key) {
                item.state = state.to_string();
                item.progress = if state == "done" { 1.0 } else { 0.0 };
                item.path = path.map(|p| p.to_string_lossy().to_string());
                let snapshot = item.clone();
                drop(list);
                engine.emit(AppEvent::Download {
                    view: serde_json::to_value(&snapshot).unwrap_or(serde_json::Value::Null),
                });
            }
        });

        Ok(view)
    }

    /// 把待推的意图推到 B 站。目前只处理喜欢。
    pub async fn sync_now(self: &Arc<Self>) -> Result<(), WireError> {
        let Some(mid) = self.source.nav().mid else {
            return Err(WireError::needs_login("同步需要登录"));
        };
        let pending = self.library.pending_reactions(mid, 20)?;
        for reaction in pending {
            let Some(track) = self.library.track_by_key_id(reaction.track_id)? else {
                continue;
            };
            let result = match reaction.kind {
                ReactionKind::Like => self.source.set_like(&track.key, reaction.want).await,
                ReactionKind::Fav => self.source.set_favorite(&track.key, reaction.want).await,
            };
            let state = if result.is_ok() {
                ReactionState::Synced
            } else {
                ReactionState::Rejected
            };
            self.library.mark_reaction(&reaction, state)?;
        }
        Ok(())
    }
}

mod tauri_runtime {
    use super::*;

    /// 构造 Source 需要 async，但 Engine::new 是同步的（Tauri setup 与测试都会调用）。
    ///
    /// 在独立线程上开一个小 runtime，这样既不依赖调用方是否已经在 async 上下文里，
    /// 也不会出现「runtime 里再 block_on」的 panic。
    /// 用一次短 runtime 刷新 nav，让导入的 cookie 生效。
    pub fn block_on_nav(source: &Source) -> Result<(), WireError> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| WireError::internal(e.to_string()))?;
        rt.block_on(source.refresh_session())
            .map(|_| ())
            .map_err(WireError::from)
    }

    pub fn block_on_bili() -> Result<Source, WireError> {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("bilimusic-bootstrap".into())
            .spawn(move || {
                let out = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt.block_on(Source::open()).map_err(WireError::from),
                    Err(e) => Err(WireError::internal(e.to_string())),
                };
                let _ = tx.send(out);
            })
            .map_err(|e| WireError::internal(e.to_string()))?;
        rx.recv().map_err(|e| WireError::internal(e.to_string()))?
    }
}


/// yt-dlp 的查找顺序：随包资源、当前目录、PATH。
fn find_ytdlp() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("yt-dlp"));
            // macOS 打包后资源在 Contents/Resources/
            candidates.push(dir.join("..").join("Resources").join("yt-dlp"));
            candidates.push(dir.parent().map(|p| p.join("resources").join("yt-dlp")).unwrap_or_default());
        }
    }
    // 测试与开发时工作目录在 crate 里，所以往上找两层。
    for rel in ["resources/yt-dlp", "../../resources/yt-dlp", "../../../resources/yt-dlp"] {
        candidates.push(std::path::PathBuf::from(rel));
    }
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    if std::process::Command::new("yt-dlp").arg("--version").output().is_ok() {
        return Some(std::path::PathBuf::from("yt-dlp"));
    }
    None
}

fn download_dir() -> std::path::PathBuf {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Music")
        .join("BiliMusic")
}

fn newest_file(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}
