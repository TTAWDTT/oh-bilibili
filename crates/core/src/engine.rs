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
use crate::wire::{AppEvent, AuthSnapshot, AuthUser, PlayerSnapshot, QueueView, WatchView, WireError};

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
    speed: Mutex<f32>,
    /// 恢复队列时要跳回的位置（毫秒）。0 表示从头开始。
    resume_at_ms: Mutex<u64>,
    repeat: Mutex<String>,
    events: tokio::sync::broadcast::Sender<AppEvent>,
    http: reqwest::Client,
    downloads: Mutex<Vec<DownloadView>>,
    /// 本机代理的票据表。谁能被代理转发的唯一决定处。
    tickets: crate::tickets::Tickets,
    /// 引擎启动时刻，用来给进度事件打时间戳。
    started_at: std::time::Instant,
    /// 队列恢复进度：(已补, 总数)。为 None 表示没有在恢复。
    restoring: Mutex<Option<(usize, usize)>>,
}

impl Engine {
    pub fn new(db_path: &std::path::Path) -> Result<Arc<Engine>, WireError> {
        let source = tauri_runtime::block_on_bili()?;
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
        let engine = Arc::new(Engine {
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
            speed: Mutex::new(1.0),
            resume_at_ms: Mutex::new(0),
            repeat: Mutex::new("off".into()),
            events,
            http: reqwest::Client::new(),
            downloads: Mutex::new(Vec::new()),
            restoring: Mutex::new(None),
            tickets: crate::tickets::Tickets::new(),
            started_at: std::time::Instant::now(),
        });
        engine.restore_queue();
        engine.start_progress_persist();
        engine.start_cookie_persist();
        engine.start_track_end_watch();
        Ok(engine)
    }

    /// 进度心跳。只在真的在播时发，UI 不用自己算时间。
    pub fn emit_progress(&self) {
        let snap = self.snapshot();
        if snap.phase == "playing" {
            self.emit(AppEvent::Progress {
                position_ms: snap.position_ms,
                duration_ms: snap.duration_ms,
                level: lock(&self.player).clock().level(),
                sent_at_ms: self.started_at.elapsed().as_millis() as u64,
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
        self.search_ordered(query, page, bilimusic_model::SearchOrder::TotalRank)
            .await
    }

    /// 按分区补齐搜索结果。
    ///
    /// B 站搜索接口已不收 tids，只能靠翻页凑够数量。这里最多翻 `max_pages` 页，
    /// 把命中的都收集起来；频道用不到全量时不至于打爆限速队列。
    /// 按一级分区搜索。`tid` 为 None 表示全站。
    pub async fn search_in_partition(
        &self,
        query: &str,
        page: u32,
        order: bilimusic_model::SearchOrder,
        tid: Option<u32>,
    ) -> Result<Vec<Track>, WireError> {
        self.search_scoped(query, page, order, tid, None).await
    }

    /// 带分区与时长的搜索。
    pub async fn search_scoped(
        &self,
        query: &str,
        page: u32,
        order: bilimusic_model::SearchOrder,
        tid: Option<u32>,
        duration: Option<u32>,
    ) -> Result<Vec<Track>, WireError> {
        let q = SearchQuery::parse(query, page)
            .map_err(|e| WireError::input("query", e.to_string()))?;
        let tracks = self.source.search_scoped(&q, order, tid, duration).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    #[allow(dead_code)]
    pub async fn search_by_partition(
        &self,
        query: &str,
        page: u32,
        order: bilimusic_model::SearchOrder,
        partition_ids: &[u32],
        max_pages: u32,
    ) -> Result<Vec<Track>, WireError> {
        if partition_ids.is_empty() {
            return self.search_ordered(query, page, order).await;
        }
        let mut out: Vec<Track> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for extra in 0..max_pages.clamp(1, 4) {
            let p = page + extra;
            let tracks = self.search_ordered(query, p, order).await?;
            if tracks.is_empty() {
                break;
            }
            let before = out.len();
            for t in tracks {
                let hit = t.typeid.map(|id| partition_ids.contains(&id)).unwrap_or(false);
                if hit && seen.insert(t.key.as_opaque().to_string()) {
                    self.remember(&t);
                    out.push(t);
                }
            }
            // 这一页一条都没新增，说明后面也很难再命中，提前收手。
            if out.len() == before {
                break;
            }
        }
        Ok(out)
    }

    pub async fn search_ordered(
        &self,
        query: &str,
        page: u32,
        order: bilimusic_model::SearchOrder,
    ) -> Result<Vec<Track>, WireError> {
        let q = SearchQuery::parse(query, page)
            .map_err(|e| WireError::input("query", e.to_string()))?;
        let tracks = self.source.search_ordered(&q, order).await?;
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
                // 恢复上次退出时的进度（只对恢复出来的第一首生效）。
                let resume = {
                    let mut at = lock(&self.resume_at_ms);
                    let v = *at;
                    *at = 0;
                    v
                };
                // 夹到曲目时长以内：快照是外部输入，旧版本写坏过的位置（实测存过
                // 42:02 而歌只有 2:17）不该把播放器 seek 到不存在的地方。
                let bounded = match track.duration {
                    Some(d) if d.0 > 0 => resume.min(d.0.saturating_sub(1000)),
                    _ => resume,
                };
                if bounded > 0 {
                    lock(&self.player).seek(bounded);
                }
                let mut st = lock(&self.state);
                *st = std::mem::replace(&mut *st, PlayerState::Idle).stream_ready(token, prepared);
                drop(st);
                // 开播就在后台把歌词取好：用户打开右栏时通常已经在了，
                // 不用等 lrclib 那几秒。
                {
                    let engine = self.clone();
                    let k = key.clone();
                    tokio::spawn(async move {
                        let _ = engine.lyrics_get(&k).await;
                    });
                }
                let storing = self.track_of(key)?;
                let track_id = self.library.upsert_track(&storing).map_err(WireError::from)?;
                // 每次真正进入播放才记一条历史，切歌失败不记。
                self.library.push_history(track_id).map_err(WireError::from)?;
                self.emit(AppEvent::NowPlaying {
                    track: self.track_of(key)?,
                    index: self.queue.lock().ok().and_then(|q| q.index()),
                });
                Ok(self.snapshot())
            }
            Err(err) => {
                // 这一次打开已经被更晚的一次取代，状态归新的一次管。
                // 这里如果照常置 faulted，会把用户真正在等的那次加载打成失败。
                if !self.load_is_current(token) {
                    return Err(err);
                }
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

    /// 打开观看页。一次调用给齐画面需要的东西，前端看不到任何远端地址。
    ///
    /// 只合成视频轨的 MPD。音频仍由音频引擎出声，所以视频元素上没有音轨，
    /// 不会出现两路声音，也不重复解码。
    /// `proxy_origin` 是本机代理的源，形如 `http://127.0.0.1:52194`。
    /// 端口只有外壳知道，所以由它传进来，引擎不猜。
    pub async fn open_watch(
        &self,
        key: &TrackKey,
        proxy_origin: &str,
    ) -> Result<WatchView, WireError> {
        self.open_watch_page(key, proxy_origin, None).await
    }

    /// 打开某个分P。`page` 是从 1 开始的序号，None 表示当前/第一个。
    pub async fn open_watch_page(
        &self,
        key: &TrackKey,
        proxy_origin: &str,
        page: Option<u32>,
    ) -> Result<WatchView, WireError> {
        let detail = self.source.detail(key).await?;
        let current = page
            .and_then(|no| detail.pages.iter().find(|p| p.no == no))
            .or_else(|| detail.pages.first());
        let page_cid = current.map(|p| p.cid);
        let page_no = current.map(|p| p.no).unwrap_or(1);
        let video = self.source.dash_video_at(key, page_cid).await?;
        let duration = detail.track.duration.unwrap_or(Millis(0));
        let origin = proxy_origin.trim_end_matches('/').to_string();
        let engine = self;
        let mpd = crate::dash_bridge::video_mpd(&video, duration.0, |url| {
            format!("{origin}/m/{}", engine.mint_stream(url))
        });
        let manifest_url = format!("{origin}/m/{}", self.mint_doc(mpd));
        let qualities = crate::dash_bridge::quality_list(&video);
        Ok(WatchView {
            key: key.as_opaque().to_string(),
            pages: detail.pages.clone(),
            current_page: page_no,
            manifest_url,
            duration_ms: duration.0,
            qualities,
            audio_quality: None,
        })
    }

    /// 取一页评论。评论区只读，取不到不该挡住看视频。
    pub async fn comments(
        &self,
        key: &TrackKey,
        page: u32,
    ) -> Result<crate::wire::CommentPage, WireError> {
        Ok(self.source.comments(key, page.max(1)).await?)
    }

    /// 把一条远端地址换成不透明句柄。句柄是前端能拿到的唯一地址形态。
    pub fn mint_stream(&self, url: impl Into<String>) -> String {
        self.tickets.mint(url)
    }

    /// 铸造一张指向本机文本的票，给 DASH 清单用。
    pub fn mint_doc(&self, doc: impl Into<String>) -> String {
        self.tickets.mint_doc(doc)
    }

    /// 代理兑换句柄。返回 None 就回 404。
    pub fn redeem_stream(&self, handle: &str) -> Option<crate::tickets::Payload> {
        self.tickets.redeem(handle)
    }

    /// 这次加载还是不是当前那一次。
    fn load_is_current(&self, token: LoadToken) -> bool {
        lock(&self.state).token() == Some(token)
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
        // 加载是会过期的动作。解析 URL、连 CDN 都要几百毫秒，这期间用户可能
        // 已经点了另一首；不判就 load 的话，扬声器会放 A 而状态说当前是 B。
        // 实测这个错只影响听感、不影响测试，所以一直没被发现。
        if !self.load_is_current(token) {
            return Err(WireError::internal("加载已过期，用户点了别的"));
        }
        {
            let player = lock(&self.player);
            player.load(Media::new(media)).map_err(|e| WireError::internal(e.to_string()))?;
            player.set_volume(*lock(&self.volume));
            player.set_speed(*lock(&self.speed) as f64);
            player.clock().set_speed(*lock(&self.speed) as f64);
            // 不要在 load 之后 seek(0)：load 已经重置了时钟，再 seek 一次会在
            // 音频线程刚开始推进时把帧计数打回 0，位置看起来像卡住。
        }
        // load 之后再过一次：spawn_blocking 期间仍可能有新的打开插进来。
        // 这一拍已经写了写指针，用 stop 把声卡停住，别让旧音轨继续发声。
        if !self.load_is_current(token) {
            lock(&self.player).stop();
            return Err(WireError::internal("加载已过期，用户点了别的"));
        }
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
        self.persist_queue();
        self.play_key(&key).await
    }

    /// 空闲但队列里有当前项时，把它真正加载起来。
    ///
    /// 队列是从快照恢复的，音频从未加载过；这种状态下 `player.play()` 是空操作，
    /// 用户点了播放键会觉得「点了没反应」。
    pub async fn toggle_or_load(self: &Arc<Self>) -> Result<PlayerSnapshot, WireError> {
        // 先取出 key 再 await：MutexGuard 不能跨 await 存活。
        let idle_key = {
            let idle = lock(&self.state).phase() == "idle";
            if idle {
                lock(&self.queue)
                    .current()
                    .map(|entry| entry.track.key.clone())
            } else {
                None
            }
        };
        if let Some(key) = idle_key {
            return self.play_key(&key).await;
        }
        Ok(self.toggle())
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
                // 队列走到头要把状态挪出 playing，否则「一首放完」的检测会一直重试
                {
                    let mut st = lock(&self.state);
                    let current = std::mem::replace(&mut *st, PlayerState::Idle);
                    *st = current.ended();
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

    /// 设置播放倍速 0.5..=2.0。
    pub fn set_speed(&self, speed: f32) -> PlayerSnapshot {
        let v = speed.clamp(0.5, 2.0);
        *lock(&self.speed) = v;
        {
            let player = lock(&self.player);
            player.set_speed(v as f64);
            player.clock().set_speed(v as f64);
        }
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
        let position_ms = {
            let player = lock(&self.player);
            player.clock().position_ms()
        };
        // 空闲但没有在播曲目时（比如刚恢复队列），把队列里的当前项亮出来，
        // 让用户看到「上次听的是这首、停在第几秒」，而不是一片空白。
        let track = state
            .track()
            .and_then(|k| lock(&self.known).get(k.as_opaque()).cloned())
            .or_else(|| {
                if state.phase() != "idle" {
                    return None;
                }
                lock(&self.queue).current().map(|entry| entry.track.clone())
            });
        let quality = state.prepared().map(|p| p.quality.kbps());
        PlayerSnapshot {
            phase: state.phase().to_string(),
            duration_ms: track.as_ref().and_then(|t| t.duration).map(|d| d.0).unwrap_or(0),
            track,
            position_ms,
            volume: *lock(&self.volume),
            speed: *lock(&self.speed),
            repeat: lock(&self.repeat).clone(),
            shuffle: lock(&self.queue).shuffle(),
            quality_kbps: quality,
        }
    }

    /// 把当前队列写成一行 JSON。队列是上下文，重启要能接上。
    /// 播放中每 5 秒把进度写一次。放退出事件里存是不够的——窗口被强杀就没有退出事件。
    fn start_progress_persist(self: &Arc<Self>) {
        let engine = self.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let snapshot = engine.snapshot();
            if snapshot.phase == "playing" {
                engine.persist_queue();
            }
        });
    }

    /// cookie 变了就写盘。
    ///
    /// 登录只写一次是不够的：B 站会轮换 SESSDATA，只在内存里更新会导致
    /// 重启后拿旧 cookie 被判未登录——用户看到的就是「怎么又要重新登录」。
    fn start_cookie_persist(self: &Arc<Self>) {
        let engine = self.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(10));
            if engine.source.take_cookies_dirty() {
                engine.persist_cookies();
            }
        });
    }

    /// 一首放完自动下一首。
    ///
    /// 解码器到 EOF 时只把时钟停了，上层状态仍停在 playing：位置定在末尾、
    /// 也不切歌。一个音乐播放器不能这样，所以这里补一个结束看门狗。
    fn start_track_end_watch(self: &Arc<Self>) {
        let engine = self.clone();
        let spawned = std::thread::Builder::new()
            .name("bilimusic-track-end".into())
            .spawn(move || {
                let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build()
                else {
                    return;
                };
                // 卡住的计数：连续几次发现「在播但时钟停了」才动手，避免误判
                let mut stalled = 0u32;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    if engine.reached_track_end() {
                        // 真的唱完了：切下一首；失败就停在 ended，别空转
                        if rt.block_on(engine.next()).is_err() {
                            let mut st = lock(&engine.state);
                            let current = std::mem::replace(&mut *st, PlayerState::Idle);
                            *st = current.ended();
                        }
                        stalled = 0;
                        continue;
                    }
                    // 没到末尾却停了，说明是卡住（网络断、解码出错）。
                    // 从当前位置原地续播，而不是当成播完跳下一首。
                    if !engine.stalled_midway() {
                        stalled = 0;
                        continue;
                    }
                    stalled += 1;
                    if stalled < 3 {
                        continue;
                    }
                    stalled = 0;
                    let key = lock(&engine.queue).current().map(|e| e.track.key.clone());
                    if let Some(k) = key {
                        let _ = rt.block_on(engine.play_key(&k));
                    }
                }
            });
        if let Err(e) = spawned {
            eprintln!("结束检测线程起不来: {e}");
        }
    }

    /// 时钟停了且状态还认为在播，说明解码器到了末尾。
    fn reached_track_end(&self) -> bool {
        if lock(&self.state).phase() != "playing" {
            return false;
        }
        // 只有解码器真的报「到末尾」才算播完。
        // 用位置数字判断不可靠：实测播到 5:13（时长 5:17）就 EOF 了，
        // 差 4 秒会被误判成「卡住」然后重播同一首。
        let ended = lock(&self.player).take_ended();
        ended
    }

    /// 状态说在播、时钟却停了，而且离末尾还远——这是卡住，不是播完。
    fn stalled_midway(&self) -> bool {
        if lock(&self.state).phase() != "playing" {
            return false;
        }
        let player = lock(&self.player);
        // 时钟还在走就不是卡住；自然播完也不算卡住（那条走 reached_track_end）
        !player.clock().is_playing() && !player.peek_ended()
    }

    fn persist_queue(&self) {
        let (tracks, index) = {
            let queue = lock(&self.queue);
            (queue.items(), queue.index())
        };
        if tracks.is_empty() {
            return;
        }
        // 存完整曲目而不只是 key：恢复时不必重新拉 29 首详情，打开即用。
        // 进度也一起存，否则用户还得自己拖回去。
        let snapshot = serde_json::json!({
            "tracks": tracks,
            "index": index,
            "position_ms": self.snapshot().position_ms,
        });
        if let Ok(json) = serde_json::to_string(&snapshot) {
            let _ = self.library.save_queue(&json);
        }
    }

    /// 启动时恢复上次的队列，缺的曲目在后台慢慢补齐。
    ///
    /// 先恢复能立刻拿到的，剩下的交给 [`Engine::backfill_queue`]，
    /// 启动不会被几十次网络请求拖住。
    fn restore_queue(self: &Arc<Self>) {
        let Ok(Some(raw)) = self.library.load_queue() else {
            return;
        };
        // 兼容旧格式：老版本存的是纯 key 数组。
        let parsed: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => return,
        };
        let (keys, saved_index, saved_ms, saved_tracks): (
            Vec<String>,
            usize,
            u64,
            Vec<Track>,
        ) = if parsed.is_array() {
            match serde_json::from_value::<Vec<String>>(parsed) {
                Ok(keys) => (keys, 0, 0, Vec::new()),
                Err(_) => return,
            }
        } else {
            let keys = parsed["keys"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let tracks = serde_json::from_value::<Vec<Track>>(parsed["tracks"].clone())
                .unwrap_or_default();
            (
                keys,
                parsed["index"].as_u64().unwrap_or(0) as usize,
                parsed["position_ms"].as_u64().unwrap_or(0),
                tracks,
            )
        };
        if keys.is_empty() && saved_tracks.is_empty() {
            return;
        }
        if !saved_tracks.is_empty() {
            // 新格式：曲目就在快照里，直接恢复，不用等网络。
            for t in &saved_tracks {
                self.remember(t);
            }
            let start = saved_index.min(saved_tracks.len().saturating_sub(1));
            let mut q = lock(&self.queue);
            *q = Queue::from_tracks(&saved_tracks, start);
            *lock(&self.resume_at_ms) = saved_ms;
            return;
        }
        let tracks = self.tracks_for(&keys);
        if !tracks.is_empty() {
            let start = saved_index.min(tracks.len().saturating_sub(1));
            let mut q = lock(&self.queue);
            *q = Queue::from_tracks(&tracks, start);
        }
        *lock(&self.resume_at_ms) = saved_ms;

        // 有缺的就后台补，补完再整体替换队列。
        let already = tracks.len();
        if already < keys.len() {
            let engine = self.clone();
            std::thread::spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                    Ok(rt) => rt,
                    Err(_) => return,
                };
                let total = keys.len();
                *lock(&engine.restoring) = Some((already, total));
                rt.block_on(async {
                    let mut done = already;
                    for key in &keys {
                        if !lock(&engine.known).contains_key(key) {
                            let track_key = TrackKey::from_provider(key.clone());
                            if let Ok(detail) = engine.source.detail(&track_key).await {
                                engine.remember(&detail.track);
                            }
                            // 限速队列本身会排队，这里只需要给彼此留点间隔。
                            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                        }
                        done += 1;
                        *lock(&engine.restoring) = Some((done, total));
                    }
                    let filled = engine.tracks_for(&keys);
                    if !filled.is_empty() {
                        let mut q = lock(&engine.queue);
                        *q = Queue::from_tracks(&filled, 0);
                    }
                    *lock(&engine.restoring) = None;
                });
            });
        }
    }

    /// 按 key 列表取已知曲目，顺序保持。
    fn tracks_for(&self, keys: &[String]) -> Vec<Track> {
        let known = lock(&self.known);
        keys.iter().filter_map(|k| known.get(k).cloned()).collect()
    }

    /// 从队列里移除一首。移除的是当前项时，光标落到原位置的下一首。
    pub fn queue_remove(&self, key: &str) -> Result<QueueView, WireError> {
        let mut queue = lock(&self.queue);
        let id = queue
            .entry_id_of(key)
            .ok_or_else(|| WireError::input("key", "这一项不在队列里"))?;
        queue.remove(id);
        drop(queue);
        self.persist_queue();
        let queue = lock(&self.queue);
        Ok(QueueView {
            items: queue.items(),
            index: queue.index(),
        })
    }

    /// 清空队列。
    pub fn queue_clear(&self) -> Result<QueueView, WireError> {
        {
            let mut queue = lock(&self.queue);
            *queue = Queue::from_tracks(&[], 0);
        }
        self.persist_queue();
        Ok(QueueView {
            items: Vec::new(),
            index: None,
        })
    }

    /// 队列内重排。`from` 与 `to` 都是条目身份，不是下标，所以重排后光标不会错位。
    pub fn queue_move(&self, from: &str, to: &str) -> Result<QueueView, WireError> {
        let mut queue = lock(&self.queue);
        let from_id = queue
            .entry_id_of(from)
            .ok_or_else(|| WireError::input("from", "这一项不在队列里"))?;
        let to_id = queue
            .entry_id_of(to)
            .ok_or_else(|| WireError::input("to", "目标项不在队列里"))?;
        queue.move_entry(from_id, Some(to_id));
        drop(queue);
        self.persist_queue();
        let queue = lock(&self.queue);
        Ok(QueueView {
            items: queue.items(),
            index: queue.index(),
        })
    }

    /// 队列恢复进度。界面据此显示「正在恢复 n/m」。
    pub fn queue_restore_progress(&self) -> Option<(usize, usize)> {
        *lock(&self.restoring)
    }

    pub fn queue_view(&self) -> QueueView {
        let q = lock(&self.queue);
        QueueView {
            items: q.items(),
            index: q.index(),
        }
    }

    /// 播放历史，最近的在前。
    pub fn history(&self, limit: u32) -> Result<Vec<Track>, WireError> {
        Ok(self.library.history(limit)?)
    }

    /// 删掉某首歌的历史。
    pub fn history_delete(&self, key: &str) -> Result<(), WireError> {
        self.library.delete_history(key)?;
        self.emit(AppEvent::LibraryChanged);
        Ok(())
    }

    /// 清空历史。
    pub fn history_clear(&self) -> Result<(), WireError> {
        self.library.clear_history()?;
        self.emit(AppEvent::LibraryChanged);
        Ok(())
    }

    /// 带播放时间的历史，用于按日期分组。
    pub fn history_with_time(&self, limit: u32) -> Result<Vec<(Track, i64)>, WireError> {
        Ok(self.library.history_with_time(limit)?)
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

    /// 投币。真实写进 B 站账号，失败会返回可读的错误。
    /// 批量读互动状态，用于把界面上的心/星点亮成账号里的真实状态。
    pub async fn relation_states(
        &self,
        keys: Vec<String>,
    ) -> Result<Vec<(String, bool, bool, u32)>, WireError> {
        let mut out = Vec::new();
        for key in keys {
            let track_key = TrackKey::from_provider(key.clone());
            match self.source.relation_state(&track_key).await {
                Ok((liked, faved, coin)) => out.push((key, liked, faved, coin)),
                // 未登录时整批都不会成功，直接返回错误让界面提示登录
                Err(bilimusic_bili::error::BiliError::NeedsLogin(m)) => {
                    return Err(WireError::needs_login(m))
                }
                // 单条失败跳过，不拖垮整批
                Err(_) => {}
            }
            // 接口有频率限制，逐条之间留间隔
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        }
        Ok(out)
    }

    pub async fn coin_set(&self, key: &TrackKey, count: u8, also_like: bool) -> Result<(), WireError> {
        self.source.add_coin(key, count, also_like).await?;
        Ok(())
    }

    pub async fn author_card(
        &self,
        mid: u64,
    ) -> Result<bilimusic_bili::sync::AuthorCard, WireError> {
        Ok(self.source.author_card(mid).await?)
    }

    /// 从某个收藏夹移出一条。
    pub async fn unfav_from(&self, key: &TrackKey, folder: i64) -> Result<(), WireError> {
        self.source.unfav_from(key, folder).await?;
        Ok(())
    }

    pub async fn fav_folders(&self) -> Result<Vec<(i64, String, u32)>, WireError> {
        Ok(self.source.fav_folders().await?)
    }

    pub async fn fav_tracks(&self, folder_id: i64, page: u32) -> Result<Vec<Track>, WireError> {
        let tracks = self.source.fav_tracks(folder_id, page).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    pub async fn watch_later_set(&self, key: &TrackKey, on: bool) -> Result<(), WireError> {
        self.source.set_watch_later(key, on).await?;
        Ok(())
    }

    pub async fn follow_set(&self, mid: u64, on: bool) -> Result<(), WireError> {
        self.source.set_follow(mid, on).await?;
        Ok(())
    }

    pub async fn fav_set(
        &self,
        key: &TrackKey,
        faved: bool,
        folder: Option<i64>,
    ) -> Result<(), WireError> {
        self.source.set_favorite(key, faved, folder).await?;
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
        // 同一首歌在 B 站有几十个投稿，标题清洗后往往一样。
        // 按标题命中缓存，换一条投稿就不用再打一次网络。
        let title_key = format!("title:{}", crate::lyrics::clean_title(&track.title));
        if !title_key.ends_with(':') {
            if let Some(doc) = lock(&self.lyrics_cache).get(&title_key).cloned() {
                lock(&self.lyrics_cache).insert(key.as_opaque().to_string(), doc.clone());
                return Ok(doc);
            }
        }
        // 本地 lrc 优先（用户自己放的更准）；没有就同时打 lrclib 和 B 站字幕。
        //
        // 早先是串行三级：lrclib 落空要等满它的超时，再去请求字幕，实测一首歌
        // 要 9 秒才出词。两路并发之后最坏只等较慢的那一路。
        let doc = match lyrics::from_local(&track) {
            Some(doc) => doc,
            None => {
                let (lr, sub) = tokio::join!(
                    lyrics::from_lrclib(&self.http, &track),
                    self.source.subtitles(key)
                );
                match lr {
                    Some(doc) => doc,
                    None => match sub {
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
                }
            }
        };
        lock(&self.lyrics_cache).insert(key.as_opaque().to_string(), doc.clone());
        if !title_key.ends_with(':') && !doc.lines.is_empty() {
            lock(&self.lyrics_cache).insert(title_key, doc.clone());
        }
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

    pub async fn danmaku_colored(
        &self,
        key: &TrackKey,
    ) -> Result<Vec<(f64, String, u32)>, WireError> {
        Ok(self.source.danmaku_colored(key).await?)
    }

    pub async fn danmaku_heat(&self, key: &TrackKey, buckets: usize) -> Result<Vec<u32>, WireError> {
        Ok(self.source.danmaku_heat(key, buckets).await?)
    }

    pub async fn video_meta(&self, key: &TrackKey) -> Result<bilimusic_bili::VideoMeta, WireError> {
        Ok(self.source.detail(key).await?.meta)
    }

    pub async fn related(&self, key: &TrackKey) -> Result<Vec<Track>, WireError> {
        let tracks = self.source.related(key).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    pub async fn danmaku(&self, key: &TrackKey) -> Result<Vec<String>, WireError> {
        Ok(self.source.danmaku(key).await?)
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

    /// 删掉一条已下载的音轨：先删文件再从列表移除。
    ///
    /// 文件已经被用户手动删掉时仍然把列表项去掉——列表不该显示一个不存在的文件。
    pub fn download_remove(&self, key: &str) -> Result<Vec<DownloadView>, WireError> {
        let path = {
            let list = lock(&self.downloads);
            list.iter()
                .find(|d| d.key == key)
                .and_then(|d| d.path.clone())
        };
        if let Some(p) = path {
            match std::fs::remove_file(&p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(WireError::internal(format!("删不掉文件：{e}"))),
            }
        }
        {
            let mut list = lock(&self.downloads);
            list.retain(|d| d.key != key);
        }
        self.emit(AppEvent::Download {
            view: serde_json::json!({ "key": key, "state": "removed" }),
        });
        Ok(lock(&self.downloads).clone())
    }

    /// 发一条弹幕，落在 `progress_ms` 这一刻。
    pub async fn danmaku_send(
        &self,
        key: &TrackKey,
        text: &str,
        progress_ms: u64,
    ) -> Result<(), WireError> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(WireError::input("text", "弹幕不能是空的"));
        }
        // B 站单条弹幕上限 100 字
        if trimmed.chars().count() > 100 {
            return Err(WireError::input("text", "弹幕最多 100 字"));
        }
        self.source.send_danmaku(key, trimmed, progress_ms).await?;
        Ok(())
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
                // 离线重试时不知道当初选的是哪个夹子，退回默认收藏夹
                ReactionKind::Fav => {
                    self.source.set_favorite(&track.key, reaction.want, None).await
                }
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
