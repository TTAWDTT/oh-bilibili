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
use bilimusic_store::{Library, Reaction, ReactionKind, ReactionState, StoredDownload};

use crate::lyrics::{self, LyricDoc};
use crate::state::{LoadToken, PlayerState, Prepared, Queue};
use crate::wire::{
    AppEvent, AuthSnapshot, AuthUser, PlayerSnapshot, QueueView, SyncOutcome, WatchView, WireError,
};

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadView {
    pub key: String,
    pub title: String,
    pub state: String,
    pub progress: f32,
    pub path: Option<String>,
    pub error: Option<String>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 观看页打开的代际门。详情查询可能比后来的打开慢，旧请求不能改队列、
/// 分P、续播点，也不能起播。key 还用于让旧页面的 close_watch 只取消自己。
#[derive(Default)]
struct WatchGate {
    state: Mutex<WatchGateState>,
}

#[derive(Default)]
struct WatchGateState {
    generation: u64,
    key: Option<String>,
}

impl WatchGate {
    fn begin(&self, key: &str) -> u64 {
        let mut state = lock(&self.state);
        state.generation += 1;
        state.key = Some(key.to_string());
        state.generation
    }

    fn is_current(&self, generation: u64) -> bool {
        lock(&self.state).generation == generation
    }

    fn is_key(&self, key: &str) -> bool {
        lock(&self.state).key.as_deref() == Some(key)
    }

    fn cancel_for(&self, key: &str) {
        let mut state = lock(&self.state);
        if state.key.as_deref() != Some(key) {
            return;
        }
        state.generation += 1;
        state.key = None;
    }

    fn cancel(&self) {
        let mut state = lock(&self.state);
        state.generation += 1;
        state.key = None;
    }
}

#[cfg(test)]
mod watch_gate_tests {
    use super::WatchGate;

    #[test]
    fn 旧的打开和旧的关闭都碰不到新的观看页() {
        let gate = WatchGate::default();
        let first = gate.begin("BV1A");
        assert!(gate.is_current(first));
        assert!(gate.is_key("BV1A"));

        let second = gate.begin("BV1B");
        assert!(!gate.is_current(first));
        assert!(gate.is_current(second));
        assert!(!gate.is_key("BV1A"));
        assert!(gate.is_key("BV1B"));

        gate.cancel_for("BV1A");
        assert!(gate.is_current(second));
        gate.cancel_for("BV1B");
        assert!(!gate.is_current(second));
        assert!(!gate.is_key("BV1B"));
    }

    #[test]
    fn 关闭全部会取消当前() {
        let gate = WatchGate::default();
        let generation = gate.begin("BV1A");
        gate.cancel();
        assert!(!gate.is_current(generation));
        assert!(!gate.is_key("BV1A"));
    }
}

#[cfg(test)]
mod download_restore_tests {
    use super::{download_key_of, restored_download};
    use bilimusic_model::{Track, TrackKey};
    use bilimusic_store::Library;

    fn track(key: &str) -> Track {
        Track {
            key: TrackKey::from_provider(key),
            title: format!("歌 {key}"),
            artist: "某人".into(),
            duration: None,
            cover: None,
            accent: None,
            views: None,
            danmaku: None,
            up_avatar: None,
            up_mid: None,
            tname: None,
            typeid: None,
        }
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "bilimusic-core-{tag}-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn 下载记录重开后按磁盘现状恢复() {
        let dir = temp_dir("download-restore");
        let db = dir.join("library.sqlite");
        let audio = dir.join("晴天 [BV1xx411c7mD].m4a");
        std::fs::write(&audio, b"audio").unwrap();
        let gone = dir.join("海底 [BV1yy411c7mE].m4a");

        {
            let library = Library::open(&db).unwrap();
            library
                .save_download(
                    &track("BV1xx411c7mD"),
                    Some(audio.to_str().unwrap()),
                    "done",
                    None,
                )
                .unwrap();
            library
                .save_download(
                    &track("BV1yy411c7mE"),
                    Some(gone.to_str().unwrap()),
                    "done",
                    None,
                )
                .unwrap();
            library
                .save_download(&track("BV1zz411c7mF"), None, "running", None)
                .unwrap();
        }

        let library = Library::open(&db).unwrap();
        let views: Vec<_> = library
            .downloads()
            .unwrap()
            .iter()
            .map(restored_download)
            .collect();
        assert_eq!(views.len(), 3);
        assert_eq!(views[0].state, "done");
        assert_eq!(views[0].path.as_deref(), audio.to_str());
        assert_eq!(views[1].state, "missing");
        assert_eq!(views[2].state, "failed");
        assert_eq!(views[2].error.as_deref(), Some("上次下载被中断"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 从_yt_dlp_文件名认出键与标题() {
        let path = std::path::Path::new("/tmp/晴天 [BV1xx411c7mD].m4a");
        assert_eq!(
            download_key_of(path),
            Some(("BV1xx411c7mD".into(), "晴天".into()))
        );
        assert_eq!(
            download_key_of(std::path::Path::new("/tmp/晴天.m4a")),
            None
        );
        assert_eq!(
            download_key_of(std::path::Path::new("/tmp/晴天 [BV1xx411c7mD].part")),
            None
        );
    }
}

#[cfg(test)]
mod queue_restore_tests {
    use super::{replace_queue_if_untouched, Engine};
    use crate::state::Queue;
    use bilimusic_model::{Track, TrackKey};
    use bilimusic_store::Library;

    fn track(key: &str) -> Track {
        Track {
            key: TrackKey::from_provider(key),
            title: key.into(),
            artist: String::new(),
            duration: None,
            cover: None,
            accent: None,
            views: None,
            danmaku: None,
            up_avatar: None,
            up_mid: None,
            tname: None,
            typeid: None,
        }
    }

    fn keys(items: &[Track]) -> Vec<String> {
        items
            .iter()
            .map(|t| t.key.as_opaque().to_string())
            .collect()
    }

    #[test]
    fn 播放前重排其他曲目保持续播点() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "bilimusic-queue-restore-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("library.sqlite");
        let a = track("BV1");
        let b = track("BV2");
        let c = track("BV3");
        let saved = serde_json::json!({
            "tracks": [&a, &b, &c],
            "index": 0,
            "position_ms": 65_000,
        });
        Library::open(&db)
            .unwrap()
            .save_queue(&saved.to_string())
            .unwrap();

        let engine = Engine::new(&db).unwrap();
        let before = engine.snapshot();
        let reordered = engine
            .queue_move(c.key.as_opaque(), b.key.as_opaque())
            .unwrap();
        let after = engine.snapshot();
        let persisted = Library::open(&db).unwrap().load_queue().unwrap().unwrap();
        let persisted: serde_json::Value = serde_json::from_str(&persisted).unwrap();
        drop(engine);
        let restarted = Engine::new(&db).unwrap().snapshot();
        std::fs::remove_dir_all(dir).unwrap();

        assert_eq!(before.phase, "idle");
        assert_eq!(reordered.items, [a.clone(), c, b]);
        assert_eq!(reordered.index, Some(0));
        assert_eq!(persisted["tracks"], serde_json::json!(reordered.items));
        assert_eq!(persisted["index"], serde_json::json!(reordered.index));
        assert_eq!(persisted["position_ms"], 65_000, "重排后落盘的续播点");
        assert_eq!(before.position_ms, 65_000);
        assert_eq!(after.track.as_ref(), Some(&a));
        assert_eq!(after.position_ms, 65_000);
        assert_eq!(restarted.track, Some(a));
        assert_eq!(restarted.position_ms, 65_000);
    }

    #[test]
    fn 后台补全只在队列没被动过时替换() {
        let a = track("BV1");
        let b = track("BV2");
        let c = track("BV3");
        // 旧格式恢复时本地全未命中，补全从空队列开始。
        let mut queue = Queue::from_tracks(&[], 0);
        let generation = queue.generation();

        assert!(replace_queue_if_untouched(
            &mut queue,
            generation,
            &[a.clone(), b.clone(), c.clone()],
            1
        ));
        assert_eq!(queue.items().len(), 3);
        assert_eq!(queue.index(), Some(1), "补全后光标还停在原来那一首");
    }

    #[test]
    fn 用户清空重排或切歌后补全不覆盖() {
        let a = track("BV1");
        let b = track("BV2");
        let c = track("BV3");
        let filled = [a.clone(), b.clone(), c.clone()];

        let mut cleared = Queue::from_tracks(&[a.clone(), b.clone()], 1);
        let generation = cleared.generation();
        cleared.replace_from_tracks(&[], 0);
        assert!(!replace_queue_if_untouched(
            &mut cleared,
            generation,
            &filled,
            1
        ));
        assert_eq!(cleared.items().len(), 0, "清空后不能被补全带回来");

        let mut reordered = Queue::from_tracks(&[b.clone(), a.clone()], 0);
        let generation = reordered.generation();
        let b_id = reordered.entry_id_of("BV2").expect("队列里有 BV2");
        let a_id = reordered.entry_id_of("BV1").expect("队列里有 BV1");
        reordered.move_entry(a_id, Some(b_id));
        assert!(!replace_queue_if_untouched(
            &mut reordered,
            generation,
            &filled,
            0
        ));
        assert_eq!(
            keys(&reordered.items()),
            keys(&[a.clone(), b.clone()]),
            "重排后保持用户顺序"
        );

        let mut switched = Queue::from_tracks(&[a.clone(), b.clone()], 0);
        let generation = switched.generation();
        let b_id = switched.entry_id_of("BV2").expect("队列里有 BV2");
        switched.jump(b_id);
        assert!(!replace_queue_if_untouched(
            &mut switched,
            generation,
            &filled,
            0
        ));
        assert_eq!(switched.index(), Some(1), "切歌后的光标不能被拨回去");
    }

    #[test]
    fn 补全等待期间换歌再清空_迟到的曲目不能落回() {
        let mut queue = Queue::from_tracks(&[], 0);
        let generation = queue.generation();
        // 用户换到 X，再清空；当前值又回到空队列。
        let x_id = queue.push_back(track("BVX"));
        queue.jump(x_id);
        queue.replace_from_tracks(&[], 0);

        assert!(!replace_queue_if_untouched(
            &mut queue,
            generation,
            &[track("BV1"), track("BV2")],
            0
        ));
        assert!(queue.is_empty(), "迟到的 A/B 不能把清空后的队列填回来");
    }

    #[test]
    fn 没补到任何曲目就不替换() {
        let a = track("BV1");
        let mut queue = Queue::from_tracks(&[a], 0);
        let generation = queue.generation();
        assert!(!replace_queue_if_untouched(
            &mut queue,
            generation,
            &[],
            0
        ));
        assert_eq!(queue.items().len(), 1);
    }
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
    /// 已经取到、但还没等到声卡首批样本的这一次加载。
    /// 音轨就绪前状态保持 loading，看门狗看到 `is_started()` 后才迁到 playing。
    pending_prepared: Mutex<Option<(LoadToken, Prepared)>>,
    volume: Mutex<f32>,
    speed: Mutex<f32>,
    /// 恢复队列时要跳回的位置（毫秒）。0 表示从头开始。
    resume_at_ms: Mutex<u64>,
    /// 看模式下当前 P 的 cid。`detail.cid` 永远是第一 P，多 P 视频取音轨
    /// 必须换成用户正在看的那一 P，否则每一集放的都是 P1 的声音。
    watch_cid: Mutex<Option<(String, u64)>>,
    repeat: Mutex<String>,
    events: tokio::sync::broadcast::Sender<AppEvent>,
    http: reqwest::Client,
    downloads: Mutex<Vec<DownloadView>>,
    /// 会话当前的渲染目标。看与听共用位置，只有画面这一项不同。
    mode: Mutex<crate::wire::PlayMode>,
    /// 本机代理的票据表。谁能被代理转发的唯一决定处。
    tickets: crate::tickets::Tickets,
    /// 引擎启动时刻，用来给进度事件打时间戳。
    started_at: std::time::Instant,
    /// 最近一次 load、seek 或续播动作。看门狗在这之后留出缓冲，避免把
    /// 大跨度 seek 的解码停顿误判成网络卡死，然后重载回 0。
    last_transport_at: Mutex<std::time::Instant>,
    /// 队列恢复进度：(已补, 总数)。为 None 表示没有在恢复。
    restoring: Mutex<Option<(usize, usize)>>,
    /// 最近一次清空前的完整队列。只保留一层，供界面上的「撤销」使用。
    cleared_queue: Mutex<Option<Queue>>,
    watch_gate: WatchGate,
}

impl Engine {
    pub fn new(db_path: &std::path::Path) -> Result<Arc<Engine>, WireError> {
        let library = Library::open(db_path)?;
        let source = Source::new()?;
        let cookie_file = db_path.with_file_name("cookies.json");
        load_cookies(&source, &cookie_file);
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
            pending_prepared: Mutex::new(None),
            volume: Mutex::new(0.7),
            speed: Mutex::new(1.0),
            resume_at_ms: Mutex::new(0),
            watch_cid: Mutex::new(None),
            repeat: Mutex::new("off".into()),
            events,
            http: reqwest::Client::new(),
            downloads: Mutex::new(Vec::new()),
            restoring: Mutex::new(None),
            cleared_queue: Mutex::new(None),
            mode: Mutex::new(crate::wire::PlayMode::Listen),
            tickets: crate::tickets::Tickets::new(),
            started_at: std::time::Instant::now(),
            last_transport_at: Mutex::new(std::time::Instant::now()),
            watch_gate: WatchGate::default(),
        });
        engine.start_session_refresh();
        engine.restore_queue();
        engine.restore_downloads();
        engine.start_progress_persist();
        engine.start_progress_report();
        engine.start_cookie_persist();
        engine.start_track_end_watch();
        Ok(engine)
    }

    /// 启动后异步补一次设备指纹与登录态。
    ///
    /// 这一步不能塞进 `Engine::new`：断网时网络请求会把 Tauri setup 一起拖住，
    /// 本地曲库也跟着打不开。失败就保持默认的未登录快照，等下一次业务请求
    /// 或用户手动刷新。
    fn start_session_refresh(self: &Arc<Self>) {
        let engine = self.clone();
        std::thread::Builder::new()
            .name("bilimusic-session".into())
            .spawn(move || {
                let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build()
                else {
                    return;
                };
                if rt.block_on(engine.source.refresh_session()).is_ok() {
                    engine.emit(AppEvent::AuthChanged { auth: engine.auth() });
                }
            })
            .ok();
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

    /// 推一次完整快照。相位或模式变了就调它，界面不必轮询。
    fn emit_state(&self) {
        self.emit(AppEvent::State {
            snapshot: self.snapshot(),
        });
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
        *lock(&self.last_transport_at) = std::time::Instant::now();
        *lock(&self.pending_prepared) = None;
        {
            let player = lock(&self.player);
            // 换曲先停掉旧音轨并清零时钟。新流要等网络，期间 snapshot()
            // 仍会读这个时钟；不清零就会短暂把上一条的位置挂到新视频上。
            player.stop();
            player.reset_clock();
        }
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
                *lock(&self.last_transport_at) = std::time::Instant::now();
                // 取流完成不等于声卡已经出声。状态先留在 loading，看门狗看到
                // `Player::is_started()` 后才迁到 playing；否则首段等待期间
                // 就会显示「正在播放」而位置一直是 0。
                *lock(&self.pending_prepared) = Some((token, prepared));
                // 开播就在后台把歌词取好：用户打开右栏时通常已经在了，
                // 不用等 lrclib 那几秒。
                {
                    let engine = self.clone();
                    let k = key.clone();
                    tokio::spawn(async move {
                        let _ = engine.lyrics_get(&k).await;
                    });
                }
                self.emit(AppEvent::NowPlaying {
                    track: self.track_of(key)?,
                    index: self.queue.lock().ok().and_then(|q| q.index()),
                });
                self.emit_state();
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
                    op: "播放".into(),
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
        self: &Arc<Self>,
        key: &TrackKey,
        proxy_origin: &str,
    ) -> Result<WatchView, WireError> {
        self.open_watch_page(key, proxy_origin, None, None).await
    }

    /// 打开某个分P。`page` 是从 1 开始的序号，None 表示当前/第一个。
    /// `resume_at_ms` 是这一 P 自己的续播点；显式给出时优先于按整条视频存的历史。
    pub async fn open_watch_page(
        self: &Arc<Self>,
        key: &TrackKey,
        proxy_origin: &str,
        page: Option<u32>,
        resume_at_ms: Option<u64>,
    ) -> Result<WatchView, WireError> {
        let generation = self.watch_gate.begin(key.as_opaque());
        // 打开观看页就是「看」模式：底部音频条按模式隐藏，
        // 不会出现「没在听却挂着一条音频」。
        *lock(&self.mode) = crate::wire::PlayMode::Watch;
        let detail = self.source.detail(key).await?;
        // 详情查询可能跨越一次切视频。迟到的旧详情不能再改队列、分P、
        // 续播点，更不能起播；否则用户已经看到 B，声音却被 A 抢走。
        if !self.watch_gate.is_current(generation) {
            return Err(WireError::internal("打开已过期，用户已经切走"));
        }
        // 观看也把这一条设成队列当前项：否则切到「听」会接着放队列里上一首，
        // 用户看到的是 A 却听到 B。实测踩到过。
        // jump_by_key 只在条目已存在时有效，所以不存在要先插进去。
        lock(&self.known).insert(key.as_opaque().to_string(), detail.track.clone());
        {
            let mut queue = lock(&self.queue);
            if !queue.jump_by_key(key) {
                queue.push_back(detail.track.clone());
                queue.jump_by_key(key);
            }
        }
        let current = page
            .and_then(|no| detail.pages.iter().find(|p| p.no == no))
            .or_else(|| detail.pages.first());
        let page_cid = current.map(|p| p.cid);
        let page_no = current.map(|p| p.no).unwrap_or(1);
        *lock(&self.watch_cid) = current.map(|p| (key.as_opaque().to_string(), p.cid));
        // 观看页首次打开时把历史进度交给 play_key，让音频在 load 完成后直接
        // 从上次位置起播。前端再 seek 一次时，视频和声音已经在同一个点上，
        // 不会出现「进度条先跳过去、音频还在 0」的竞态。
        *lock(&self.resume_at_ms) = resume_at_ms.unwrap_or_else(|| {
            if page.is_none() {
                self.library
                    .history_position(key.as_opaque())
                    .ok()
                    .flatten()
                    .unwrap_or(0)
            } else {
                0
            }
        });
        // 打开观看页就要有声音。引擎是唯一的发声者，这里顺手把它挂上：
        // 前端不需要再补一次「开始播放」，也就不会因为调用失败而静音。
        // 起播要等拉流，放后台跑，页面先出来。
        {
            let engine = Arc::clone(self);
            let track = detail.track.key.clone();
            tokio::spawn(async move {
                let _ = engine.play_key(&track).await;
            });
        }
        // 模式切到「看」这一步也要让界面知道：底部播放条、右栏歌词
        // 都按模式决定是否出现，不给它们新快照就会停在「听」的旧状态。
        self.emit_state();
        let video = self.source.dash_video_at(key, page_cid).await?;
        // 多 P 视频的总时长是整条投稿的 14 小时，不是当前这一 P 的时长。
        // 进度条和 MPD 都必须用当前 P 的时长，否则切到 P2 还显示 14:10:58。
        let duration = current
            .filter(|p| p.duration_ms > 0)
            .map(|p| Millis(p.duration_ms))
            .or(detail.track.duration)
            .unwrap_or(Millis(0));
        let origin = proxy_origin.trim_end_matches('/').to_string();
        let engine = self;
        let mpd = crate::dash_bridge::video_mpd(&video, duration.0, |url| {
            format!("{origin}/m/{}", engine.mint_stream(url))
        });
        let manifest_url = format!("{origin}/m/{}", self.mint_doc(mpd));
        let qualities = crate::dash_bridge::quality_list(&video);
        Ok(WatchView {
            key: key.as_opaque().to_string(),
            desc: detail.meta.desc.clone(),
            owner: detail.track.artist.clone(),
            owner_mid: detail.track.up_mid,
            owner_avatar: detail.track.up_avatar.clone(),
            stats: crate::wire::WatchStats {
                views: detail.meta.views,
                danmaku: detail.meta.danmaku,
                likes: detail.meta.likes,
                coins: detail.meta.coins,
                favorites: detail.meta.favorites,
                shares: detail.meta.shares,
                replies: detail.meta.replies,
            },
            pubdate: detail.meta.pubdate,
            tname: detail.track.tname.clone(),
            pages: detail.pages.clone(),
            current_page: page_no,
            season: detail.season.as_ref().map(|season| crate::wire::SeasonView {
                id: season.id,
                title: season.title.clone(),
                episodes: season
                    .episodes
                    .iter()
                    .map(|ep| crate::wire::SeasonEpisodeView {
                        key: ep.bvid.clone(),
                        title: ep.title.clone(),
                        cover: ep.cover.clone(),
                        duration_ms: ep.duration_ms,
                        views: ep.views,
                        current: ep.bvid == key.as_opaque(),
                    })
                    .collect(),
            }),
            manifest_url,
            duration_ms: duration.0,
            qualities,
            audio_quality: None,
        })
    }

    /// 切换渲染目标。
    ///
    /// 从「看」切到「听」时，界面把画面当前的位置传进来，音频引擎从那里接着放。
    /// 位置因此不需要在两处各存一份：画面读它时用同一份时钟。
    /// 离开观看页。看模式下的声音就是这条视频的，页都退了还出声等于没关掉；
    /// 听模式必须留着，那是用户主动选的后台播放。
    ///
    /// `key` 是离开时那一页的视频。换片时旧页面先卸载、新页面随后开播，
    /// 两个调用都在异步路上；按 key 比对，旧页面的清理不会把新视频掐掉。
    pub fn close_watch(&self, key: Option<&TrackKey>) -> PlayerSnapshot {
        if *lock(&self.mode) != crate::wire::PlayMode::Watch {
            return self.snapshot();
        }
        if let Some(key) = key {
            // 旧页面的 cleanup 可能晚于新页面的打开到达。只取消自己那一代，
            // 不能把后来页面或用户主动播放的声音停掉。
            if self.watch_gate.is_key(key.as_opaque()) {
                self.watch_gate.cancel_for(key.as_opaque());
            } else {
                // 新页面还没真正起播时，旧音轨仍可能是这一条；让它停下，
                // 但不要动新页面那一代的打开。
                let current = self.snapshot().track.map(|t| t.key);
                if current.as_ref() != Some(key) {
                    return self.snapshot();
                }
            }
        } else {
            self.watch_gate.cancel();
        }
        *lock(&self.pending_prepared) = None;
        lock(&self.player).stop();
        {
            let mut st = lock(&self.state);
            *st = std::mem::replace(&mut *st, PlayerState::Idle).ended();
        }
        self.emit_state();
        self.snapshot()
    }

    pub async fn set_mode(
        self: &Arc<Self>,
        mode: crate::wire::PlayMode,
        at_ms: Option<u64>,
        key: Option<&TrackKey>,
    ) -> Result<PlayerSnapshot, WireError> {
        *lock(&self.mode) = mode;
        if mode == crate::wire::PlayMode::Watch {
            let snapshot = self.snapshot();
            // 模式本身也是快照的一部分。同一条已经加载好时不会走 play_key，
            // 没有这条事件，界面就会一直以为还在看。
            self.emit_state();
            return Ok(snapshot);
        }

        // 要听哪一条：调用方给了就用它，否则用队列当前项。
        // 只看「有没有在放」不够——正在放 A 却要看 B 的时候，
        // 那样会继续放 A，用户看到 B 听到 A。实测踩到过。
        // 比的是「实际加载的那一条」，不是队列当前项：观看时队列当前项
        // 已经被改成目标了，拿它比会得出「不用加载」，结果继续放旧的。
        let loaded = self.snapshot().track.map(|t| t.key);
        let target = key.cloned().or_else(|| lock(&self.queue).current().map(|e| e.track.key.clone()));
        let needs_load = match (&target, &loaded) {
            (Some(t), Some(l)) => t != l,
            (Some(_), None) => true,
            (None, _) => false,
        } || matches!(lock(&self.state).phase(), "idle" | "faulted" | "ended");

        if needs_load {
            let Some(t) = target else {
                return Err(WireError::input("queue", "队列是空的"));
            };
            let snapshot = self.play_key(&t).await?;
            if let Some(at) = at_ms.filter(|v| *v > 0) {
                self.seek(at);
            }
            self.emit_state();
            return Ok(snapshot);
        }
        if let Some(at) = at_ms.filter(|v| *v > 0) {
            self.seek(at);
        }
        let snapshot = self.snapshot();
        self.emit_state();
        Ok(snapshot)
    }

    /// 给测试与手动触发用的进度上报。
    pub async fn report_progress_public(
        &self,
        key: &TrackKey,
        played_secs: u64,
        start_ts: u64,
    ) -> Result<(), WireError> {
        Ok(self.source.report_progress(key, played_secs, start_ts).await?)
    }

    /// UP 主投稿。`order`：pubdate 最新、click 最多播放、stow 最多收藏。
    pub async fn space_videos(
        &self,
        mid: u64,
        page: u32,
        order: &str,
    ) -> Result<(Vec<bilimusic_model::Track>, u32), WireError> {
        let (tracks, total) = self.source.space_videos(mid, page, order).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok((tracks, total))
    }

    /// UP 主粉丝与关注数。
    pub async fn space_stat(&self, mid: u64) -> Result<(u64, u64), WireError> {
        Ok(self.source.space_stat(mid).await?)
    }

    /// 我关注的人。返回列表与该页总数。
    pub async fn following(
        &self,
        page: u32,
    ) -> Result<(Vec<bilimusic_bili::sync::Followed>, u32), WireError> {
        Ok(self.source.following(page).await?)
    }

    /// 关注动态。
    pub async fn dynamic_feed(
        &self,
        offset: Option<String>,
    ) -> Result<crate::wire::DynamicPage, WireError> {
        Ok(self.source.dynamic_feed(offset).await?)
    }

    pub async fn message_unread(&self) -> Result<crate::wire::MessageUnread, WireError> {
        Ok(self.source.message_unread().await?)
    }

    pub async fn messages(
        &self,
        kind: crate::wire::MessageKind,
        cursor: Option<String>,
        page: u32,
    ) -> Result<crate::wire::MessagePage, WireError> {
        Ok(self.source.messages(kind, cursor, page).await?)
    }

    /// 稍后再看列表。
    pub async fn watch_later_list(&self) -> Result<Vec<bilimusic_model::Track>, WireError> {
        let tracks = self.source.watch_later_list().await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    /// 首页推荐。风控拒绝时返回空列表，界面显示「换一批」。
    pub async fn home_feed(&self, fresh: u32) -> Result<Vec<bilimusic_model::Track>, WireError> {
        let tracks = self.source.home_feed(fresh).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    /// 取一页评论。取不到不该挡住看视频。
    pub async fn comments(
        &self,
        key: &TrackKey,
        cursor: Option<&str>,
        hot: bool,
    ) -> Result<crate::wire::CommentPage, WireError> {
        Ok(self.source.comments(key, cursor, hot).await?)
    }

    /// 取一页楼中楼。
    pub async fn comment_replies(
        &self,
        key: &TrackKey,
        root: &str,
        cursor: Option<&str>,
    ) -> Result<crate::wire::CommentPage, WireError> {
        Ok(self.source.comment_replies(key, root, cursor).await?)
    }

    pub async fn comment_dialog(
        &self,
        key: &TrackKey,
        root: &str,
        dialog: &str,
        cursor: Option<&str>,
    ) -> Result<crate::wire::CommentPage, WireError> {
        Ok(self.source.comment_dialog(key, root, dialog, cursor).await?)
    }

    pub async fn search_suggest(&self, term: &str) -> Result<Vec<String>, WireError> {
        let term = term.trim();
        if term.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self.source.search_suggest(term).await?)
    }

    /// 搜索页的热搜榜。取不到就返回空表，界面退回内置建议。
    pub async fn hot_search(&self) -> Vec<crate::wire::HotSearchItem> {
        self.source.hot_search().await.unwrap_or_default()
    }

    /// 发评论；`root` 与 `parent` 都为空时是评论，否则是回复。
    pub async fn comment_add(
        &self,
        key: &TrackKey,
        text: &str,
        root: Option<&str>,
        parent: Option<&str>,
    ) -> Result<String, WireError> {
        Ok(self.source.comment_add(key, text, root, parent).await?)
    }

    /// 删掉自己发的一条评论。
    pub async fn comment_del(&self, key: &TrackKey, rpid: &str) -> Result<(), WireError> {
        self.source.comment_del(key, rpid).await?;
        Ok(())
    }

    /// 给一条评论点赞或取消点赞。
    pub async fn comment_like(
        &self,
        key: &TrackKey,
        rpid: &str,
        like: bool,
    ) -> Result<(), WireError> {
        self.source.comment_like(key, rpid, like).await?;
        Ok(())
    }

    /// 给一条评论点踩或取消点踩。
    pub async fn comment_hate(
        &self,
        key: &TrackKey,
        rpid: &str,
        hate: bool,
    ) -> Result<(), WireError> {
        self.source.comment_hate(key, rpid, hate).await?;
        Ok(())
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
        let mut detail = self.source.detail(key).await?;
        // 多 P 视频的 `detail.cid` 是第一 P。观看页切到第 N P 时音轨也得跟着换，
        // 否则听到的仍是 P1 的声音，播到 P1 结尾就当成整集播完。
        if let Some((_, cid)) = lock(&self.watch_cid)
            .as_ref()
            .filter(|(bvid, _)| bvid == key.as_opaque())
        {
            detail.cid = *cid;
        }
        // 详情是字段最全的一份（UP 主头像、分区名都在里面），把它写回 known。
        // 入库与卡片都从 known 取，不写回的话历史里的头像会一直是空的——
        // 队列里那份来自列表接口，字段没这么全。
        lock(&self.known).insert(key.as_opaque().to_string(), detail.track.clone());
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

    /// 按列表里的 key 组播放队列。
    ///
    /// keys 必须来自已经 remember 过曲目的列表接口；这里不逐条取详情，
    /// 否则从稍后再看播放全部会先发几十个详情请求。
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
            q.replace_from_tracks(&tracks, start);
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
        self.emit_state();
        self.snapshot()
    }

    /// 只暂停，不切换播放态。离开观看页时用它收声音。
    ///
    /// 引擎不知道用户什么时候离开页面，早先实测退出后声音还在放，
    /// 而那时连播放条都不显示，等于声音失去控制。
    pub fn pause(&self) -> PlayerSnapshot {
        let playing = lock(&self.player).clock().is_playing();
        // 取流期时钟还没开始，也要记住用户的暂停意图。否则 load 完成后
        // 会把音轨直接放出来，退出观看页时尤其明显。
        lock(&self.player).pause();
        if playing {
            {
                let mut st = lock(&self.state);
                let current = std::mem::replace(&mut *st, PlayerState::Idle);
                *st = current.pause();
            }
            // emit_state 内部会 snapshot()，那里还要再锁一次 state。
            // 在锁没放的时候调它，同一个线程会把自己锁死——实测整个界面
            // 冻住、CPU 0%，采样里所有线程都停在 snapshot 的第一把锁上。
            self.emit_state();
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
        if lock(&self.state).phase() == "ended" {
            return self.snapshot();
        }
        *lock(&self.last_transport_at) = std::time::Instant::now();
        // 正好落在曲目时长上的 seek 会被解码器拒掉（实测按 End 之后位置不动、
        // 也不报错），拖到最右就是这种情况。停在末尾前一秒，让解码器自然读到 EOF，
        // 播完该切歌仍由 reached_track_end 负责。
        let duration = {
            let st = lock(&self.state);
            st.track()
                .and_then(|k| lock(&self.known).get(k.as_opaque()).cloned())
                .and_then(|t| t.duration)
                .map(|d| d.0)
                .unwrap_or(0)
        };
        let target = if duration > 1000 && position_ms >= duration - 1000 {
            duration - 1000
        } else {
            position_ms
        };
        lock(&self.player).seek(target);
        self.snapshot()
    }

    /// 从头重播当前视频。结束态的 PlayerState 不保留解码准备信息，
    /// 单靠 seek(0) 回不到 playing，所以重新走一次 play_key。
    pub async fn replay(self: &Arc<Self>) -> Result<PlayerSnapshot, WireError> {
        let key = lock(&self.queue).current().map(|e| e.track.key.clone());
        match key {
            Some(k) => {
                let snap = self.play_key(&k).await?;
                // 重播是从头看，历史进度也该归零。
                let _ = self.library.set_history_position(k.as_opaque(), 0);
                Ok(snap)
            }
            None => Ok(self.snapshot()),
        }
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
            mode: *lock(&self.mode),
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

    /// 播放中每 20 秒向 B 站上报一次观看进度。
    ///
    /// 只有位置变了才报，避免暂停时反复发同样的数。未登录时直接跳过：
    /// 这不是核心功能，失败也不该影响本地播放。
    fn start_progress_report(self: &Arc<Self>) {
        let engine = self.clone();
        let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
            return;
        };
        std::thread::Builder::new()
            .name("bilimusic-progress-report".into())
            .spawn(move || {
                let mut last_secs = u64::MAX;
                let started = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(20));
                    let snapshot = engine.snapshot();
                    if snapshot.phase != "playing" {
                        continue;
                    }
                    let secs = snapshot.position_ms / 1000;
                    if secs == last_secs || secs == 0 {
                        continue;
                    }
                    let Some(track) = snapshot.track else { continue };
                    last_secs = secs;
                    // 失败只记一条追迹，不重试也不打扰用户
                    let result = rt.block_on(engine.source.report_progress(&track.key, secs, started));
                    if result.is_err() {
                        if std::env::var_os("BILIMUSIC_AUDIO_TRACE").is_some() {
                            eprintln!("[progress] 上报失败（不影响播放）");
                        }
                    }
                }
            })
            .ok();
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
                // 每 5 秒把当前位置写回历史，卡片上的进度条才不会永远停在起点。
                let mut ticks = 0u32;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    ticks += 1;
                    if ticks >= 12 {
                        ticks = 0;
                        // seek 刚发出时时钟还在 0，这时候回写会清掉续播点。
                        if lock(&engine.last_transport_at).elapsed()
                            >= std::time::Duration::from_secs(5)
                        {
                            let snap = engine.snapshot();
                            // 切歌加载期间状态已经指向新曲，但音频时钟还停在上一首，
                            // 这时候回写会把旧位置记到新曲头上，顺带清掉续播点。
                            if snap.phase == "playing" || snap.phase == "paused" {
                                if let Some(t) = snap.track {
                                    let _ = engine
                                        .library
                                        .set_history_position(t.key.as_opaque(), snap.position_ms);
                                }
                            }
                        }
                    }
                    if engine.promote_loading() {
                        continue;
                    }
                    if engine.reached_track_end() {
                        // 看模式下放完由观看页决定（重播 / 下一个 / 自动连播）。
                        // 引擎自己跳下一首会让画面停在旧视频、声音换成另一条，
                        // 结束面板也永远等不到 ended。
                        if *lock(&engine.mode) == crate::wire::PlayMode::Watch {
                            lock(&engine.player).pause();
                            let mut st = lock(&engine.state);
                            let current = std::mem::replace(&mut *st, PlayerState::Idle);
                            *st = current.ended();
                            drop(st);
                            engine.emit_state();
                            stalled = 0;
                            continue;
                        }
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
                    if lock(&engine.last_transport_at).elapsed() < std::time::Duration::from_secs(5) {
                        stalled = 0;
                        continue;
                    }
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
                        // 重载会重新签一次流地址；从断点续上，别让一次 CDN 断流把进度送回 0:00。
                        let at = lock(&engine.player).clock().position_ms();
                        *lock(&engine.resume_at_ms) = at;
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

    /// 取流完成、且声卡已经输出首批样本后，才把 loading 迁到 playing。
    fn promote_loading(&self) -> bool {
        let (token, track_key) = match &*lock(&self.state) {
            PlayerState::Loading { token, track } => (*token, track.clone()),
            _ => return false,
        };
        let (clock_playing, ended) = {
            let player = lock(&self.player);
            if player.load_failed() {
                drop(player);
                if !self.load_is_current(token) {
                    return false;
                }
                *lock(&self.pending_prepared) = None;
                let mut st = lock(&self.state);
                *st = std::mem::replace(&mut *st, PlayerState::Idle)
                    .fail(crate::state::Fault::Decode("音轨打不开".into()));
                drop(st);
                self.emit(AppEvent::Notice {
                    error: WireError::internal("音轨打不开，换一条或稍后重试"),
                    op: "播放".into(),
                });
                self.emit_state();
                return true;
            }
            let ended = player.peek_ended();
            if !player.is_started() && !ended {
                return false;
            }
            (player.clock().is_playing(), ended)
        };
        let prepared = {
            let mut pending = lock(&self.pending_prepared);
            match pending.as_ref() {
                Some((pending_token, _)) if *pending_token == token => {
                    pending.take().map(|(_, prepared)| prepared)
                }
                _ => None,
            }
        };
        let Some(prepared) = prepared else {
            return false;
        };
        let mut st = lock(&self.state);
        let current = match &*st {
            PlayerState::Loading { token: current, .. } if *current == token => {
                std::mem::replace(&mut *st, PlayerState::Idle)
            }
            _ => return false,
        };
        let next = current.stream_ready(token, prepared);
        let watch_mode = *lock(&self.mode) == crate::wire::PlayMode::Watch;
        *st = if ended {
            // 极短音频可能在状态迁到 playing 之前就播完了。看模式下直接给
            // 结束面板；听模式留在 playing，让下一拍看门狗走正常的自动下一首。
            if watch_mode {
                next.ended()
            } else {
                next
            }
        } else if clock_playing {
            next
        } else {
            next.pause()
        };
        drop(st);
        if ended && watch_mode {
            lock(&self.player).pause();
            let _ = lock(&self.player).take_ended();
        }
        if let Ok(track) = self.track_of(&track_key) {
            if let Ok(track_id) = self.library.upsert_track(&track) {
                let at = lock(&self.player).clock().position_ms();
                let _ = self.library.push_history(track_id, at);
            }
        }
        self.emit_state();
        true
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
            q.replace_from_tracks(&saved_tracks, start);
            *lock(&self.resume_at_ms) = saved_ms;
            return;
        }
        let tracks = self.tracks_for(&keys);
        if !tracks.is_empty() {
            let start = saved_index.min(tracks.len().saturating_sub(1));
            let mut q = lock(&self.queue);
            q.replace_from_tracks(&tracks, start);
        }
        *lock(&self.resume_at_ms) = saved_ms;

        // 有缺的就后台补，补完再整体替换队列。
        let already = tracks.len();
        if already < keys.len() {
            // 补全期间用户可能清空、重排、切歌或换了新队列。记下开始时的
            // 队列代数，回来时只要变过就不覆盖。
            let generation = lock(&self.queue).generation();
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
                    replace_queue_if_untouched(
                        &mut lock(&engine.queue),
                        generation,
                        &filled,
                        saved_index,
                    );
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
        let saved = lock(&self.queue).take_clear_snapshot();
        *lock(&self.cleared_queue) = saved;
        self.persist_queue();
        Ok(QueueView {
            items: Vec::new(),
            index: None,
        })
    }

    /// 撤销最近一次清空：整个队列原样放回，随机顺序和当前项都不丢。
    pub fn queue_undo_clear(&self) -> Result<QueueView, WireError> {
        let saved = lock(&self.cleared_queue).take();
        let Some(saved) = saved else {
            return Err(WireError::input("queue", "没有可撤销的清空"));
        };
        lock(&self.queue).restore_from_snapshot(saved);
        self.persist_queue();
        Ok(self.queue_view())
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
    pub fn history_with_time(
        &self,
        limit: u32,
        before: Option<(i64, u64)>,
    ) -> Result<Vec<(Track, i64, u64, i64)>, WireError> {
        Ok(self
            .library
            .history_with_time(limit, before.map(|(played_at, id)| (played_at, id as i64)))?)
    }

    /// 某条视频上次看到的位置，观看页打开时用来定位。
    pub fn history_position(&self, key: &str) -> Result<Option<u64>, WireError> {
        Ok(self.library.history_position(key)?)
    }

    /// 批量查历史进度，给右栏推荐画看过的进度。
    pub fn history_positions(&self, keys: &[String]) -> Result<Vec<(String, u64)>, WireError> {
        Ok(self.library.history_positions(keys)?)
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

    pub async fn fav_folders(&self) -> Result<Vec<bilimusic_bili::sync::FavFolder>, WireError> {
        Ok(self.source.fav_folders().await?)
    }

    pub async fn fav_covers(&self, folder_id: i64, limit: u32) -> Result<Vec<String>, WireError> {
        Ok(self.source.fav_covers(folder_id, limit).await?)
    }

    pub async fn liked_videos(&self) -> Result<Vec<Track>, WireError> {
        let tracks = self.source.liked_videos().await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    pub async fn video_tags(&self, key: &TrackKey) -> Result<Vec<String>, WireError> {
        Ok(self.source.video_tags(&key.as_opaque()).await?)
    }

    pub async fn comment_emotes(&self) -> Result<Vec<(String, String)>, WireError> {
        Ok(self.source.comment_emotes().await?)
    }

    pub async fn search_users(
        &self,
        keyword: &str,
        page: u32,
    ) -> Result<Vec<bilimusic_bili::sync::UserHit>, WireError> {
        Ok(self.source.search_users(keyword, page).await?)
    }

    pub async fn ranking(&self, rid: u32) -> Result<Vec<Track>, WireError> {
        let tracks = self.source.ranking(rid).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(tracks)
    }

    /// 直播推荐位。
    pub async fn live_rooms(
        &self,
        count: u32,
        page: u32,
    ) -> Result<Vec<crate::wire::LiveRoomView>, WireError> {
        let rooms = self.source.live_rooms(count, page).await?;
        Ok(rooms
            .into_iter()
            .map(|room| crate::wire::LiveRoomView {
                url: format!("https://live.bilibili.com/{}", room.room_id),
                room_id: room.room_id,
                title: room.title,
                uname: room.uname,
                face: room.face,
                cover: room.cover,
                area: room.area,
                online: room.online,
            })
            .collect())
    }

    /// 番剧更新表。
    pub async fn bangumi_timeline(
        &self,
    ) -> Result<Vec<crate::wire::BangumiDayView>, WireError> {
        let days = self.source.bangumi_timeline().await?;
        Ok(days
            .into_iter()
            .map(|day| crate::wire::BangumiDayView {
                date: day.date,
                weekday: day.weekday,
                today: day.today,
                episodes: day
                    .episodes
                    .into_iter()
                    .map(|ep| crate::wire::BangumiEpisodeView {
                        url: format!("https://www.bilibili.com/bangumi/play/ss{}", ep.season_id),
                        season_id: ep.season_id,
                        title: ep.title,
                        cover: ep.cover,
                        pub_index: ep.pub_index,
                        pub_time: ep.pub_time,
                    })
                    .collect(),
            })
            .collect())
    }

    /// 番剧排行。
    pub async fn bangumi_rank(
        &self,
        count: usize,
        season_type: u32,
    ) -> Result<Vec<crate::wire::BangumiView>, WireError> {
        if !(1..=5).contains(&season_type) {
            return Err(WireError::input("season_type", "分类必须为 1 到 5"));
        }
        let list = self.source.bangumi_rank(count, season_type).await?;
        Ok(list.into_iter().map(bangumi_view).collect())
    }

    /// 当前账号的追番。
    pub async fn followed_bangumi(
        &self,
        page: u32,
    ) -> Result<(Vec<crate::wire::BangumiView>, u32), WireError> {
        let (list, total) = self.source.followed_bangumi(page).await?;
        Ok((list.into_iter().map(bangumi_view).collect(), total))
    }

    pub async fn popular(&self, page: u32) -> Result<crate::wire::PopularPage, WireError> {
        let (tracks, no_more, notes) = self.source.popular(page).await?;
        for t in &tracks {
            self.remember(t);
        }
        Ok(crate::wire::PopularPage {
            items: tracks
                .into_iter()
                .map(|track| crate::wire::PopularItemView {
                    note: notes.get(track.key.as_opaque()).cloned().unwrap_or_default(),
                    track,
                })
                .collect(),
            no_more,
        })
    }

    /// 每周必看的期数列表。
    pub async fn weekly_issues(&self) -> Result<Vec<crate::wire::WeeklyIssueView>, WireError> {
        let list = self.source.weekly_issues().await?;
        Ok(list
            .into_iter()
            .map(|issue| crate::wire::WeeklyIssueView {
                number: issue.number,
                subject: issue.subject,
                name: issue.name,
            })
            .collect())
    }

    /// 每周必看某一期的片单。
    pub async fn weekly_issue(&self, number: u32) -> Result<crate::wire::WeeklyPage, WireError> {
        let page = self.source.weekly_issue(number).await?;
        for t in &page.tracks {
            self.remember(t);
        }
        Ok(crate::wire::WeeklyPage {
            subject: page.subject,
            label: page.label,
            tracks: page.tracks,
            notes: page.notes,
        })
    }

    /// 入站必刷。返回标题、官方文案与带推荐语的条目。
    pub async fn precious(&self) -> Result<crate::wire::PreciousView, WireError> {
        let (title, explain, items) = self.source.precious().await?;
        for item in &items {
            self.remember(&item.track);
        }
        Ok(crate::wire::PreciousView {
            title,
            explain,
            items: items
                .into_iter()
                .map(|item| crate::wire::PreciousItemView {
                    track: item.track,
                    note: item.note,
                })
                .collect(),
        })
    }

    /// 观看页的元信息：在看人数与可用字幕轨。
    pub async fn watch_meta(&self, key: &TrackKey, cid: u64) -> Result<crate::wire::VideoMeta, WireError> {
        Ok(self.source.video_meta(&key.as_opaque(), cid).await?)
    }

    /// 这条视频的 AI 总结；没有总结的稿件返回 None。
    pub async fn watch_summary(
        &self,
        key: &TrackKey,
        cid: u64,
        up_mid: u64,
    ) -> Result<Option<crate::wire::VideoSummary>, WireError> {
        Ok(self
            .source
            .video_summary(&key.as_opaque(), cid, up_mid)
            .await?)
    }

    /// 一条字幕轨的全部台词。`lan` 为空时优先中文。
    pub async fn subtitle_cues(
        &self,
        key: &TrackKey,
        cid: Option<u64>,
        lan: Option<&str>,
    ) -> Result<Vec<crate::wire::SubtitleCue>, WireError> {
        Ok(self.source.subtitle_cues(key, cid, lan).await?)
    }

    /// 进度条悬停预览用的缩略图雪碧图。
    pub async fn video_shots(&self, key: &TrackKey, cid: u64) -> Result<crate::wire::VideoShots, WireError> {
        Ok(self.source.video_shots(&key.as_opaque(), cid).await?)
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

    pub async fn is_following(&self, mid: u64) -> Result<bool, WireError> {
        Ok(self.source.is_following(mid).await?)
    }

    pub async fn relation_followed_many(&self, mids: &[u64]) -> Result<Vec<(u64, bool)>, WireError> {
        Ok(self.source.relation_followed_many(mids).await?)
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
                level: nav.level,
                coins: nav.coins,
            }),
        }
    }

    /// 重新拉一次设备指纹与登录态。网络恢复后由设置页触发，不用重启。
    pub async fn refresh_session(&self) -> Result<AuthSnapshot, WireError> {
        self.source.refresh_session().await?;
        let auth = self.auth();
        self.emit(AppEvent::AuthChanged { auth: auth.clone() });
        Ok(auth)
    }

    /// 把当前 cookie 写进应用数据目录。含登录令牌，只存本机。
    fn persist_cookies(&self) {
        let pairs = self.source.export_cookies();
        if let Ok(json) = serde_json::to_string(&pairs) {
            let _ = std::fs::write(&self.cookie_file, json);
        }
    }

    pub async fn danmaku_colored(
        &self,
        key: &TrackKey,
        cid: Option<u64>,
    ) -> Result<Vec<crate::wire::DanmakuLine>, WireError> {
        Ok(self.source.danmaku_colored(key, cid).await?)
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

    /// 把文本渲染成二维码 SVG。分享面板的二维码只在本地生成。
    pub fn qr_svg(&self, text: &str) -> Result<String, WireError> {
        Ok(bilimusic_bili::auth::qr_svg(text)?)
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

    /// 只删索引记录，不碰磁盘。
    ///
    /// 启动时记为 missing 的条目，路径后来可能重新出现文件：用户可能接回了磁盘，
    /// 原路径上也可能是另一个同名文件。没有确认删除音频就不能动它。
    pub fn download_remove_record(&self, key: &str) -> Result<Vec<DownloadView>, WireError> {
        self.remove_download(key, false)
    }

    /// 确认删除音频：先删文件，再删记录。
    ///
    /// 文件已经被用户手动删掉时仍然把列表项去掉——用户点了删除，列表就不该再留着。
    pub fn download_delete_audio(&self, key: &str) -> Result<Vec<DownloadView>, WireError> {
        self.remove_download(key, true)
    }

    fn remove_download(
        &self,
        key: &str,
        delete_file: bool,
    ) -> Result<Vec<DownloadView>, WireError> {
        if delete_file {
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
        }
        self.library.delete_download(key)?;
        {
            let mut list = lock(&self.downloads);
            list.retain(|d| d.key != key);
        }
        Ok(lock(&self.downloads).clone())
    }

    /// 发一条弹幕，落在 `progress_ms` 这一刻。
    pub async fn danmaku_send(
        &self,
        key: &TrackKey,
        cid: Option<u64>,
        text: &str,
        progress_ms: u64,
        mode: u64,
        color: u32,
    ) -> Result<(), WireError> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(WireError::input("text", "弹幕不能是空的"));
        }
        // B 站单条弹幕上限 100 字
        if trimmed.chars().count() > 100 {
            return Err(WireError::input("text", "弹幕最多 100 字"));
        }
        if !matches!(mode, 1 | 4 | 5) {
            return Err(WireError::input("mode", "弹幕位置只有滚动、顶部、底部"));
        }
        self.source
            .send_danmaku(key, cid, trimmed, progress_ms, mode, color)
            .await?;
        Ok(())
    }

    pub fn downloads(&self) -> Vec<DownloadView> {
        lock(&self.downloads).clone()
    }

    /// 启动时把上次的下载记录装回来。文件已经不在的完成项标成 missing，
    /// 上次没跑完的任务标成 failed，两者都能从界面重新发起。
    fn restore_downloads(&self) {
        let records = match self.library.downloads() {
            Ok(records) => records,
            Err(e) => {
                eprintln!("读取下载记录失败：{e}");
                return;
            }
        };
        if records.is_empty() {
            self.rebuild_downloads_from_disk();
            return;
        }

        let mut views = Vec::with_capacity(records.len());
        for record in &records {
            if record.state != "done" && record.state != "failed" {
                let _ = self.library.update_download(
                    record.key.as_opaque(),
                    record.path.as_deref(),
                    "failed",
                    Some("上次下载被中断"),
                );
            }
            views.push(restored_download(record));
        }
        *lock(&self.downloads) = views;
    }

    /// 老版本从没写过下载记录。yt-dlp 的落盘文件名带着 `[BVxxx]`，据此把
    /// 文件认回来；认出来的记录要落库，否则用户删掉的下次启动又会出现。
    fn rebuild_downloads_from_disk(&self) {
        let Ok(entries) = std::fs::read_dir(downloads_dir()) else {
            return;
        };
        let mut views: Vec<DownloadView> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some((key, fallback_title)) = download_key_of(&path) else {
                continue;
            };
            if views.iter().any(|view| view.key == key) {
                continue;
            }
            let track_key = TrackKey::from_provider(key.clone());
            let title = self
                .library
                .track_by_key(&track_key)
                .ok()
                .flatten()
                .map(|track| track.title)
                .unwrap_or(fallback_title);
            let path_text = path.to_string_lossy().to_string();
            let _ = self.library.adopt_download(&track_key, &title, &path_text);
            views.push(DownloadView {
                key,
                title,
                state: "done".into(),
                progress: 1.0,
                path: Some(path_text),
                error: None,
            });
        }
        views.sort_by(|a, b| a.path.cmp(&b.path));
        *lock(&self.downloads) = views;
    }

    /// 用 yt-dlp 把一首歌落到本地。任务在后台跑，进度靠事件与轮询列表两种方式看。
    pub async fn enqueue_download(
        self: &Arc<Self>,
        key: &TrackKey,
    ) -> Result<DownloadView, WireError> {
        let track = self.track_of(key)?;
        let helper = crate::download::find_helper()
            .ok_or_else(|| WireError::internal("找不到 yt-dlp，请检查应用安装或 PATH"))?;
        let dir = downloads_dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| WireError::internal(format!("建不了下载目录：{e}")))?;

        let view = DownloadView {
            key: key.as_opaque().to_string(),
            title: track.title.clone(),
            state: "running".into(),
            progress: 0.0,
            path: None,
            error: None,
        };
        self.library.save_download(&track, None, "running", None)?;
        {
            let mut list = lock(&self.downloads);
            if let Some(existing) = list.iter().find(|d| {
                d.key == view.key && (d.state == "queued" || d.state == "running")
            }) {
                return Ok(existing.clone());
            }
            list.retain(|d| d.key != view.key);
            list.push(view.clone());
        }
        self.emit(AppEvent::Download {
            view: serde_json::to_value(&view).unwrap_or(serde_json::Value::Null),
        });

        let url = format!("https://www.bilibili.com/video/{}", key.as_opaque());
        let engine = self.clone();
        let view_key = view.key.clone();

        tokio::task::spawn_blocking(move || {
            let (state, path, error) = match crate::download::audio(&helper, &dir, &url) {
                Ok(path) => ("done", Some(path), None),
                Err(e) => {
                    eprintln!("下载失败：{e}");
                    ("failed", None, Some(e.to_string()))
                }
            };
            let path_text = path.map(|p| p.to_string_lossy().to_string());
            let _ = engine.library.update_download(
                &view_key,
                path_text.as_deref(),
                state,
                error.as_deref(),
            );
            let mut list = lock(&engine.downloads);
            if let Some(item) = list.iter_mut().find(|d| d.key == view_key) {
                item.state = state.to_string();
                item.progress = if state == "done" { 1.0 } else { 0.0 };
                item.path = path_text;
                item.error = error;
                let snapshot = item.clone();
                drop(list);
                engine.emit(AppEvent::Download {
                    view: serde_json::to_value(&snapshot).unwrap_or(serde_json::Value::Null),
                });
            }
        });

        Ok(view)
    }

    /// 网络、限流、登录态属于可重试，保留 pending；其余才是永久拒绝。
    fn reaction_failure_state(err: &WireError) -> ReactionState {
        match err {
            WireError::Retryable { .. }
            | WireError::RateLimited { .. }
            | WireError::NeedsLogin { .. } => ReactionState::Pending,
            _ => ReactionState::Rejected,
        }
    }

    /// 把待推的意图推到 B 站。目前只处理喜欢。
    pub async fn sync_now(self: &Arc<Self>) -> Result<SyncOutcome, WireError> {
        let Some(mid) = self.source.nav().mid else {
            return Err(WireError::needs_login("同步需要登录"));
        };
        let source = &self.source;
        sync_pending(&self.library, mid, |track, reaction| async move {
            match reaction.kind {
                ReactionKind::Like => source
                    .set_like(&track.key, reaction.want)
                    .await
                    .map_err(WireError::from),
                // 离线重试时不知道当初选的是哪个夹子，退回默认收藏夹
                ReactionKind::Fav => source
                    .set_favorite(&track.key, reaction.want, None)
                    .await
                    .map_err(WireError::from),
            }
        })
        .await
    }
}

/// 推完当前账号全部的待办，返回本次真正发生的结果。
///
/// 待办在开始时就一次取全，暂时失败的条目仍留在 pending，但本次不再重试。
async fn sync_pending<F, Fut>(
    library: &Library,
    mid: u64,
    mut write: F,
) -> Result<SyncOutcome, WireError>
where
    F: FnMut(Track, Reaction) -> Fut,
    Fut: std::future::Future<Output = Result<(), WireError>>,
{
    let mut outcome = SyncOutcome {
        synced: 0,
        deferred: 0,
        rejected: 0,
        detail: None,
    };
    for reaction in library.pending_reactions_all(mid)? {
        let Some(track) = library.track_by_key_id(reaction.track_id)? else {
            library.mark_reaction(&reaction, ReactionState::Rejected)?;
            outcome.rejected += 1;
            outcome
                .detail
                .get_or_insert_with(|| "曲目已不在本地记录里".into());
            continue;
        };
        match write(track, reaction.clone()).await {
            Ok(()) => {
                library.mark_reaction(&reaction, ReactionState::Synced)?;
                outcome.synced += 1;
            }
            Err(err) => {
                let state = Engine::reaction_failure_state(&err);
                library.mark_reaction(&reaction, state)?;
                if state == ReactionState::Rejected {
                    outcome.rejected += 1;
                } else {
                    outcome.deferred += 1;
                }
                outcome.detail.get_or_insert_with(|| err.message().to_string());
            }
        }
    }
    Ok(outcome)
}

#[cfg(test)]
mod sync_state_tests {
    use super::{sync_pending, Engine, ReactionState};
    use crate::wire::WireError;
    use bilimusic_model::{Millis, Track, TrackKey};
    use bilimusic_store::{Library, ReactionKind};

    fn track(n: u32) -> Track {
        Track {
            key: TrackKey::from_provider(format!("BV{n}")),
            title: format!("歌 {n}"),
            artist: String::new(),
            duration: Some(Millis(200_000)),
            cover: None,
            accent: None,
            views: None,
            danmaku: None,
            up_avatar: None,
            up_mid: None,
            tname: None,
            typeid: None,
        }
    }

    fn library_with_pending(count: u32) -> Library {
        let library = Library::open_in_memory().expect("内存库应该能开");
        for n in 0..count {
            let id = library.upsert_track(&track(n)).expect("存曲目");
            library
                .set_reaction(id, 42, ReactionKind::Like, true)
                .expect("记一条待办");
        }
        library
    }

    #[tokio::test]
    async fn 一次同步推完启动时的全部待办() {
        let library = library_with_pending(21);
        let mut pushed = Vec::new();
        let outcome = sync_pending(&library, 42, |track, _| {
            pushed.push(track.key.as_opaque().to_string());
            async { Ok::<(), WireError>(()) }
        })
        .await
        .expect("同步应该成功");

        assert_eq!(outcome.synced, 21, "21 条都要推");
        assert_eq!(pushed.len(), 21, "每条只推一次");
        assert!(
            library.pending_reactions(42, 50).unwrap().is_empty(),
            "没有遗留待办"
        );
    }

    #[tokio::test]
    async fn 暂时失败的条目同一轮不重试() {
        let library = library_with_pending(21);
        let mut calls = 0;
        let outcome = sync_pending(&library, 42, |track, _| {
            calls += 1;
            let fails = track.key.as_opaque() == "BV0";
            async move {
                if fails {
                    Err(WireError::Retryable {
                        message: "超时".into(),
                        retry_after_ms: None,
                    })
                } else {
                    Ok(())
                }
            }
        })
        .await
        .expect("同步应该成功");

        assert_eq!(calls, 21, "失败的那条本次不能再试一遍");
        assert_eq!(outcome.synced, 20);
        assert_eq!(outcome.deferred, 1);
        assert_eq!(
            library.pending_reactions(42, 50).unwrap().len(),
            1,
            "暂时失败留给下一轮"
        );
    }

    #[test]
    fn 短暂失败保留待办_明确拒绝才作废() {
        assert_eq!(
            Engine::reaction_failure_state(&WireError::Retryable {
                message: "超时".into(),
                retry_after_ms: None,
            }),
            ReactionState::Pending
        );
        assert_eq!(
            Engine::reaction_failure_state(&WireError::RateLimited {
                message: "限流".into(),
                retry_after_ms: 1000,
            }),
            ReactionState::Pending
        );
        assert_eq!(
            Engine::reaction_failure_state(&WireError::needs_login("登录失效")),
            ReactionState::Pending
        );
        assert_eq!(
            Engine::reaction_failure_state(&WireError::internal("业务拒绝")),
            ReactionState::Rejected
        );
    }
}

/// 后台补全回来时，只有队列代数还是发起补全时的那一代才替换。
///
/// 补全可能跨几秒到几十秒，期间用户可能清空、重排、切歌或换了新队列；
/// 只看曲目和下标不够——换到 X 再清空又会回到空队列。
fn replace_queue_if_untouched(
    queue: &mut Queue,
    generation: u64,
    filled: &[Track],
    saved_index: usize,
) -> bool {
    if filled.is_empty() || queue.generation() != generation {
        return false;
    }
    let start = saved_index.min(filled.len() - 1);
    queue.replace_from_tracks(filled, start);
    true
}

fn bangumi_view(item: bilimusic_bili::sync::BangumiItem) -> crate::wire::BangumiView {
    crate::wire::BangumiView {
        url: format!("https://www.bilibili.com/bangumi/play/ss{}", item.season_id),
        season_id: item.season_id,
        title: item.title,
        cover: item.cover,
        rank: item.rank,
        rating: item.rating,
        index_show: item.index_show,
        play_text: item.play_text,
    }
}

/// 启动时把上次的登录态装回去，否则每次重开都要重新扫码。
///
/// 读不到或格式不对就当没有登录态，不影响本地曲库。
fn load_cookies(source: &Source, path: &std::path::Path) {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(pairs) = serde_json::from_str::<Vec<(String, String)>>(&raw) else {
        return;
    };
    source.import_cookies(&pairs);
}

/// 把一条落盘记录还原成界面状态。`missing` 只活在内存里：文件回来时
/// 下次启动会自动恢复成 done，不必把磁盘的暂时状态写进库。
fn restored_download(record: &StoredDownload) -> DownloadView {
    let on_disk = record
        .path
        .as_deref()
        .is_some_and(|path| std::path::Path::new(path).is_file());
    let (state, error) = match record.state.as_str() {
        "done" if on_disk => ("done", record.error.clone()),
        "done" => ("missing", record.error.clone()),
        "failed" => ("failed", record.error.clone()),
        _ => ("failed", Some("上次下载被中断".to_string())),
    };
    DownloadView {
        key: record.key.as_opaque().to_string(),
        title: record.title.clone(),
        state: state.into(),
        progress: if state == "done" { 1.0 } else { 0.0 },
        path: record.path.clone(),
        error,
    }
}

const AUDIO_EXTS: [&str; 7] = ["m4a", "webm", "opus", "mp3", "flac", "aac", "ogg"];

/// yt-dlp 的 `-o` 模板是「标题 [id].扩展名」。只认这种文件名，
/// 半截的 .part 与目录里的其它文件不碰。
fn download_key_of(path: &std::path::Path) -> Option<(String, String)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if !AUDIO_EXTS.contains(&ext.as_str()) {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let open = stem.rfind(" [")?;
    let key = stem.get(open + 2..)?.strip_suffix(']')?;
    if key.is_empty() || key.contains(char::is_whitespace) {
        return None;
    }
    let title = stem[..open].trim();
    Some((
        key.to_string(),
        if title.is_empty() {
            stem.to_string()
        } else {
            title.to_string()
        },
    ))
}

/// 下载目录。界面上的「打开目录」用它，免得前端自己拼 HOME。
pub fn downloads_dir() -> std::path::PathBuf {
    dirs::audio_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Music")))
        .unwrap_or_else(std::env::temp_dir)
        .join("BiliMusic")
}

#[cfg(test)]
mod offline_boot_tests {
    use super::Engine;
    use std::ffi::OsString;
    use std::time::{Duration, Instant};

    /// 把所有代理指向一个必然拒绝连接的地址，等价于外网不可达。
    struct BlockedNetwork {
        old: Vec<(&'static str, Option<OsString>)>,
    }

    impl BlockedNetwork {
        fn new() -> BlockedNetwork {
            let keys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
            let old = keys.iter().map(|key| (*key, std::env::var_os(key))).collect();
            for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
                std::env::set_var(key, "http://127.0.0.1:1");
            }
            std::env::set_var("NO_PROXY", "");
            BlockedNetwork { old }
        }
    }

    impl Drop for BlockedNetwork {
        fn drop(&mut self) {
            for (key, value) in &self.old {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    fn temp_db() -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("bilimusic-offline-{}-{nanos}.sqlite", std::process::id()))
    }

    #[test]
    fn 断网时引擎仍能起来并读本地曲库() {
        let network = BlockedNetwork::new();
        let probe = bilimusic_bili::Source::new().expect("数据源构造不该联网");
        let probe_rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        assert!(
            probe_rt.block_on(probe.refresh_session()).is_err(),
            "不可达代理应该让网络请求失败"
        );

        let db = temp_db();
        let started = Instant::now();
        let engine = Engine::new(&db).expect("断网不该挡住启动");
        // 这条守的是「不要等 20 秒的 HTTP 超时」，不是启动性能指标：
        // 声卡初始化在慢机器或设备繁忙时本身就要几秒。
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "Engine::new 不该等网络，实际 {:?}",
            started.elapsed()
        );
        assert!(!engine.auth().logged_in, "断网时只该是未登录快照");
        assert!(engine.auth().user.is_none());
        assert!(
            probe_rt.block_on(engine.refresh_session()).is_err(),
            "断网时手动刷新应该报错，不能伪造登录态"
        );
        assert!(!engine.auth().logged_in);

        let playlist = engine.create_playlist("离线歌单").expect("本地写入应该可用");
        assert!(engine
            .playlists()
            .expect("读歌单")
            .iter()
            .any(|p| p.id == playlist.id));
        assert!(engine.history(10).expect("读历史").is_empty());

        drop(engine);
        drop(network);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", db.display()));
        }
    }
}
