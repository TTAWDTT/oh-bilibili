//! 本地曲库。
//!
//! 一个连接、一个写者、全部方法同步。这样「持锁跨 await」在语法上就写不出来。
//! schema 版本用 `PRAGMA user_version`，迁移只追加。

use std::path::Path;
use std::sync::Mutex;

use bilimusic_model::{Millis, PageCursor, Track, TrackId, TrackKey};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

pub const SCHEMA_VERSION: i64 = 7;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("数据库错误：{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("数据不合法：{0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// 同步意图的方向。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReactionKind {
    Like,
    Fav,
}

impl ReactionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ReactionKind::Like => "like",
            ReactionKind::Fav => "fav",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReactionState {
    Pending,
    Synced,
    Rejected,
    Stale,
}

impl ReactionState {
    pub fn as_str(self) -> &'static str {
        match self {
            ReactionState::Pending => "pending",
            ReactionState::Synced => "synced",
            ReactionState::Rejected => "rejected",
            ReactionState::Stale => "stale",
        }
    }
}

/// 一条待同步的意图。`want` 是想要什么，`state` 是走到哪一步。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reaction {
    pub track_id: TrackId,
    pub mid: u64,
    pub kind: ReactionKind,
    pub want: bool,
    pub state: ReactionState,
    pub attempts: u32,
    version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub sort_key: i64,
}

/// 一条下载记录。`state` 的取值由 core 定义，store 只原样保存。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDownload {
    pub key: TrackKey,
    pub title: String,
    pub path: Option<String>,
    pub state: String,
    pub error: Option<String>,
}

pub struct Library {
    conn: Mutex<Connection>,
}

impl Library {
    pub fn open(path: &Path) -> Result<Library> {
        let conn = Connection::open(path)?;
        Library::from_connection(conn)
    }

    pub fn open_in_memory() -> Result<Library> {
        Library::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Library> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let library = Library {
            conn: Mutex::new(conn),
        };
        library.migrate()?;
        Ok(library)
    }

    fn migrate(&self) -> Result<()> {
        let mut conn = self.conn.lock().expect("数据库连接被毒化");
        loop {
            let tx = conn.transaction()?;
            let version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
            if version >= SCHEMA_VERSION {
                return Ok(());
            }

            let next = version + 1;
            let migration = MIGRATIONS
                .get(next as usize - 1)
                .ok_or_else(|| StoreError::Invalid(format!("缺少第 {next} 号迁移")))?;
            migration.apply(&tx)?;
            tx.pragma_update(None, "user_version", next)?;
            tx.commit()?;
        }
    }

    fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        let conn = self.conn.lock().expect("数据库连接被毒化");
        Ok(f(&conn)?)
    }

    /// upsert 一首歌，返回稳定的本地 id。同一个 provider_key 永远同一个 id。
    pub fn upsert_track(&self, track: &Track) -> Result<TrackId> {
        let accent = track.accent.map(|a| {
            ((a.rgb[0] as u32) << 16) | ((a.rgb[1] as u32) << 8) | a.rgb[2] as u32
        });
        self.with(|conn| {
            conn.execute(
                "INSERT INTO tracks (provider_key, title, artist, cover, duration_ms, accent_rgb, up_avatar, up_mid)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(provider_key) DO UPDATE SET
                   title = excluded.title,
                   artist = excluded.artist,
                   cover = excluded.cover,
                   duration_ms = excluded.duration_ms,
                   accent_rgb = COALESCE(excluded.accent_rgb, tracks.accent_rgb),
                   -- 头像与 uid 不是每条接口都带，别用 NULL 覆盖已有的。
                   up_avatar = COALESCE(excluded.up_avatar, tracks.up_avatar),
                   up_mid = COALESCE(excluded.up_mid, tracks.up_mid)",
                params![
                    track.key.as_opaque(),
                    track.title,
                    track.artist,
                    track.cover,
                    track.duration.map(|d| d.0 as i64),
                    accent.map(|v| v as i64),
                    track.up_avatar,
                    track.up_mid.map(|v| v as i64),
                ],
            )?;
            conn.query_row(
                "SELECT id FROM tracks WHERE provider_key = ?1",
                params![track.key.as_opaque()],
                |r| r.get::<_, i64>(0),
            )
            .map(TrackId)
        })
    }

    pub fn track_by_key(&self, key: &TrackKey) -> Result<Option<Track>> {
        self.with(|conn| {
            conn.query_row(
                &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE provider_key = ?1"),
                params![key.as_opaque()],
                row_to_track,
            )
            .optional()
        })
    }

    pub fn track_by_key_id(&self, id: TrackId) -> Result<Option<Track>> {
        self.with(|conn| {
            conn.query_row(
                &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE id = ?1"),
                params![id.0],
                row_to_track,
            )
            .optional()
        })
    }

    /// 键集分页。游标是上一页最后一个 id，不是 offset。
    pub fn page_tracks(&self, after: Option<&PageCursor>, limit: u32) -> Result<Vec<Track>> {
        let limit = limit.clamp(1, 200) as i64;
        let after_id: i64 = after
            .and_then(|c| c.as_opaque().parse().ok())
            .unwrap_or(0);
        self.with(|conn| {
            let mut stmt = conn.prepare(
                &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE id > ?1 ORDER BY id ASC LIMIT ?2"),
            )?;
            let rows = stmt.query_map(params![after_id, limit], row_to_track)?;
            rows.collect()
        })
    }

    pub fn create_playlist(&self, name: &str) -> Result<Playlist> {
        let name = name.trim();
        if name.is_empty() {
            return Err(StoreError::Invalid("歌单名不能为空".into()));
        }
        let next_key: i64 = self.with(|conn| {
            conn.query_row(
                "SELECT COALESCE(MAX(sort_key), 0) + 1024 FROM playlists",
                [],
                |r| r.get(0),
            )
        })?;
        let id = self.with(|conn| {
            conn.execute(
                "INSERT INTO playlists (name, sort_key) VALUES (?1, ?2)",
                params![name, next_key],
            )?;
            Ok::<i64, rusqlite::Error>(conn.last_insert_rowid())
        })?;
        Ok(Playlist {
            id,
            name: name.to_string(),
            sort_key: next_key,
        })
    }

    pub fn playlists(&self) -> Result<Vec<Playlist>> {
        self.with(|conn| {
            let mut stmt =
                conn.prepare("SELECT id, name, sort_key FROM playlists ORDER BY sort_key ASC")?;
            let rows = stmt.query_map([], |r| {
                Ok(Playlist {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    sort_key: r.get(2)?,
                })
            })?;
            rows.collect()
        })
    }

    /// 追加到歌单末尾。sort_key 用间隔 1024 的分数索引，将来插中间不用重排整表。
    pub fn add_to_playlist(&self, playlist_id: i64, track_id: TrackId) -> Result<()> {
        self.with(|conn| {
            let next: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_key), 0) + 1024 FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, sort_key) VALUES (?1, ?2, ?3)
                 ON CONFLICT(playlist_id, track_id) DO NOTHING",
                params![playlist_id, track_id.0, next],
            )?;
            Ok(())
        })
    }

    pub fn playlist_tracks(&self, playlist_id: i64) -> Result<Vec<Track>> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                &format!(
                    "SELECT t.provider_key, t.title, t.artist, t.cover, t.duration_ms, t.up_avatar, t.up_mid
                     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
                     WHERE pt.playlist_id = ?1 ORDER BY pt.sort_key ASC"
                ),
            )?;
            let rows = stmt.query_map(params![playlist_id], row_to_track)?;
            rows.collect()
        })
    }

    /// 把某一项移到目标位置之前。只改一行，靠分数索引留出空隙。
    pub fn reorder_playlist(
        &self,
        playlist_id: i64,
        track_id: TrackId,
        before_track: Option<TrackId>,
    ) -> Result<()> {
        let keys: Vec<(i64, i64)> = self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT track_id, sort_key FROM playlist_tracks
                 WHERE playlist_id = ?1 ORDER BY sort_key ASC",
            )?;
            let rows = stmt.query_map(params![playlist_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect()
        })?;
        if keys.is_empty() {
            return Ok(());
        }

        let target_pos = match before_track {
            Some(b) => keys
                .iter()
                .position(|(id, _)| *id == b.0)
                .ok_or_else(|| StoreError::Invalid("目标项不在这个歌单里".into()))?,
            None => keys.len(),
        };
        let moving = keys
            .iter()
            .position(|(id, _)| *id == track_id.0)
            .ok_or_else(|| StoreError::Invalid("要移动的项不在这个歌单里".into()))?;

        let mut rest: Vec<(i64, i64)> = keys.clone();
        rest.remove(moving);
        let insert_at = if moving < target_pos {
            target_pos - 1
        } else {
            target_pos
        };
        let insert_at = insert_at.min(rest.len());

        let prev_key = if insert_at == 0 {
            None
        } else {
            rest.get(insert_at - 1).map(|(_, k)| *k)
        };
        let next_key = rest.get(insert_at).map(|(_, k)| *k);

        let new_key = match (prev_key, next_key) {
            (None, None) => 1024,
            (None, Some(n)) => n - 1024,
            (Some(p), None) => p + 1024,
            (Some(p), Some(n)) if n - p > 1 => p + (n - p) / 2,
            // 空隙用尽：把整张表按 1024 重排一次，再取中间值。
            (Some(_), Some(_)) => {
                self.respace_playlist(playlist_id)?;
                return self.reorder_playlist(playlist_id, track_id, before_track);
            }
        };

        self.with(|conn| {
            conn.execute(
                "UPDATE playlist_tracks SET sort_key = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
                params![new_key, playlist_id, track_id.0],
            )?;
            Ok(())
        })
    }

    fn respace_playlist(&self, playlist_id: i64) -> Result<()> {
        let ids: Vec<i64> = self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY sort_key ASC",
            )?;
            let rows = stmt.query_map(params![playlist_id], |r| r.get(0))?;
            rows.collect()
        })?;
        let conn = self.conn.lock().expect("数据库连接被毒化");
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE playlist_tracks SET sort_key = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
                params![(i as i64 + 1) * 1024, playlist_id, id],
            )?;
        }
        Ok(())
    }

    /// 记录一次播放。
    pub fn push_history(&self, track_id: TrackId, position_ms: u64) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                // 同一首歌只保留最近一次：历史是「上次看到哪」，不是播放流水。
                // 位置一起更新，历史卡片才能画出那条播放进度。
                // 0 是「刚打开、还没开始」：别用它覆盖上次看到的位置，
                // 否则重新打开视频的瞬间就把续播点清掉了。
                "INSERT INTO history (track_id, played_at, position_ms) VALUES (?1, ?2, ?3)
                 ON CONFLICT(track_id) DO UPDATE SET
                   played_at = excluded.played_at,
                   position_ms = CASE
                     WHEN excluded.position_ms > 0 THEN excluded.position_ms
                     ELSE history.position_ms
                   END",
                params![track_id.0, now_ms(), position_ms as i64],
            )?;
            Ok(())
        })
    }

    /// 只更新已存在的那条历史的位置，不新增行。
    ///
    /// 播放中每隔几秒回写一次，历史卡片的进度条才是「看到哪」而不是「从哪开始」。
    pub fn set_history_position(&self, provider_key: &str, position_ms: u64) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "UPDATE history SET position_ms = ?2
                 WHERE track_id = (SELECT id FROM tracks WHERE provider_key = ?1)",
                params![provider_key, position_ms as i64],
            )?;
            Ok(())
        })
    }

    pub fn history(&self, limit: u32) -> Result<Vec<Track>> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                &format!(
                    "SELECT t.provider_key, t.title, t.artist, t.cover, t.duration_ms, t.up_avatar, t.up_mid
                     FROM history h JOIN tracks t ON t.id = h.track_id
                     ORDER BY h.played_at DESC, h.id DESC LIMIT ?1"
                ),
            )?;
            let rows = stmt.query_map(params![limit.clamp(1, 500) as i64], row_to_track)?;
            rows.collect()
        })
    }

    /// 删掉某首歌的全部历史记录。
    pub fn delete_history(&self, provider_key: &str) -> Result<usize> {
        self.with(|conn| {
            let n = conn.execute(
                "DELETE FROM history WHERE track_id IN (SELECT id FROM tracks WHERE provider_key = ?1)",
                params![provider_key],
            )?;
            Ok(n)
        })
    }

    /// 清空全部历史。
    pub fn clear_history(&self) -> Result<usize> {
        self.with(|conn| Ok(conn.execute("DELETE FROM history", [])?))
    }

    /// 带播放时间的历史。前端要按「今天 / 昨天 / 更早」分组，得知道每条什么时候播的。
    ///
    /// 翻页用 `(played_at, id)` 作为边界，不用 offset：播放过的条目会跳到最前，
    /// offset 会让下一页重复或漏掉。`before` 为 None 时从最新一条开始。
    pub fn history_with_time(
        &self,
        limit: u32,
        before: Option<(i64, i64)>,
    ) -> Result<Vec<(Track, i64, u64, i64)>> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                &format!(
                    "SELECT {TRACK_COLUMNS}, h.played_at, h.position_ms, h.id
                     FROM history h JOIN tracks t ON t.id = h.track_id
                     WHERE ?1 IS NULL OR h.played_at < ?1 OR (h.played_at = ?1 AND h.id < ?2)
                     ORDER BY h.played_at DESC, h.id DESC LIMIT ?3"
                ),
            )?;
            let (played_at, id) = match before {
                Some((played_at, id)) => (Some(played_at), Some(id)),
                None => (None, None),
            };
            let rows = stmt.query_map(params![played_at, id, limit.clamp(1, 500) as i64], |row| {
                Ok((
                    row_to_track(row)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?.max(0) as u64,
                    row.get::<_, i64>(9)?,
                ))
            })?;
            rows.collect()
        })
    }

    /// 某条视频上次看到的位置。没有历史时返回 None，和「看过但从 0 开始」区分开。
    pub fn history_position(&self, provider_key: &str) -> Result<Option<u64>> {
        self.with(|conn| {
            Ok(conn
                .query_row(
                    "SELECT h.position_ms FROM history h
                     JOIN tracks t ON t.id = h.track_id
                     WHERE t.provider_key = ?1",
                    params![provider_key],
                    |row| Ok(row.get::<_, i64>(0)?.max(0) as u64),
                )
                .optional()?)
        })
    }

    /// 批量查历史进度：右栏一条请求就能给所有推荐画上「看过没有」。
    pub fn history_positions(&self, provider_keys: &[String]) -> Result<Vec<(String, u64)>> {
        if provider_keys.is_empty() {
            return Ok(Vec::new());
        }
        self.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT t.provider_key, h.position_ms FROM history h
                 JOIN tracks t ON t.id = h.track_id",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?.max(0) as u64))
            })?;
            let wanted: std::collections::HashSet<&str> =
                provider_keys.iter().map(String::as_str).collect();
            let mut out = Vec::new();
            for row in rows {
                let (key, position) = row?;
                if wanted.contains(key.as_str()) {
                    out.push((key, position));
                }
            }
            Ok(out)
        })
    }

    /// 写入一条同步意图。取消不是删行，是把 want 置 0。
    pub fn set_reaction(
        &self,
        track_id: TrackId,
        mid: u64,
        kind: ReactionKind,
        want: bool,
    ) -> Result<Reaction> {
        self.with(|conn| {
            conn.query_row(
                "INSERT INTO reactions (track_id, mid, kind, want, state, version)
                 VALUES (?1, ?2, ?3, ?4, 'pending', 1)
                 ON CONFLICT(track_id, mid, kind) DO UPDATE SET
                   want = excluded.want,
                   state = CASE WHEN reactions.want = excluded.want AND reactions.state = 'synced'
                                THEN 'synced' ELSE 'pending' END,
                   attempts = 0,
                   version = reactions.version + 1
                 RETURNING track_id, mid, kind, want, state, attempts, version",
                params![track_id.0, mid as i64, kind.as_str(), want as i32],
                row_to_reaction,
            )
        })
    }

    /// 某个账号待推送的意图。换号后 `WHERE mid = ?` 保证不会推错人。
    pub fn pending_reactions(&self, mid: u64, limit: u32) -> Result<Vec<Reaction>> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT track_id, mid, kind, want, state, attempts, version FROM reactions
                 WHERE mid = ?1 AND state = 'pending' ORDER BY attempts ASC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![mid as i64, limit.clamp(1, 500) as i64], row_to_reaction)?;
            rows.collect()
        })
    }

    /// 当前账号的全部待办。手动同步要一次处理完，不能因为排在后面的
    /// 旧条目 attempts 已经累加过就留在下一轮。
    pub fn pending_reactions_all(&self, mid: u64) -> Result<Vec<Reaction>> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT track_id, mid, kind, want, state, attempts, version FROM reactions
                 WHERE mid = ?1 AND state = 'pending' ORDER BY attempts ASC",
            )?;
            let rows = stmt.query_map(params![mid as i64], row_to_reaction)?;
            rows.collect()
        })
    }

    pub fn mark_reaction(&self, r: &Reaction, state: ReactionState) -> Result<()> {
        self.with(|conn| {
            let synced_at = if state == ReactionState::Synced {
                Some(now_ms())
            } else {
                None
            };
            conn.execute(
                "UPDATE reactions SET state = ?1, attempts = attempts + 1,
                   synced_at = COALESCE(?2, synced_at)
                 WHERE track_id = ?3 AND mid = ?4 AND kind = ?5 AND version = ?6",
                params![
                    state.as_str(),
                    synced_at,
                    r.track_id.0,
                    r.mid as i64,
                    r.kind.as_str(),
                    r.version,
                ],
            )?;
            Ok(())
        })
    }

    /// 换号时把别人的待推项标成 stale。一条幂等 UPDATE，不是一堆特例分支。
    pub fn mark_accounts_stale(&self, current_mid: u64) -> Result<usize> {
        self.with(|conn| {
            let changed = conn.execute(
                "UPDATE reactions SET state = 'stale' WHERE mid <> ?1 AND state = 'pending'",
                params![current_mid as i64],
            )?;
            Ok(changed)
        })
    }

    /// 存队列快照。只保留一行，每次覆盖。
    pub fn save_queue(&self, payload: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO queue_snapshot (id, payload, saved_at) VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, saved_at = excluded.saved_at",
                params![payload, now_ms()],
            )?;
            Ok(())
        })
    }

    pub fn load_queue(&self) -> Result<Option<String>> {
        self.with(|conn| {
            conn.query_row("SELECT payload FROM queue_snapshot WHERE id = 1", [], |r| {
                r.get(0)
            })
            .optional()
        })
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.with(|conn| {
            conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
                r.get(0)
            })
            .optional()
        })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }

    /// 记一条下载。曲目元数据一起入库，重启后标题还在。
    pub fn save_download(
        &self,
        track: &Track,
        path: Option<&str>,
        state: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let track_id = self.upsert_track(track)?;
        self.with(|conn| {
            conn.execute(
                "INSERT INTO downloads (track_id, path, state, error) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(track_id) DO UPDATE SET
                   path = excluded.path,
                   state = excluded.state,
                   error = excluded.error,
                   created_at = unixepoch() * 1000",
                params![track_id.0, path, state, error],
            )?;
            Ok(())
        })
    }

    /// 后台任务完成或中断时只更新下载行，曲目元数据不动。
    pub fn update_download(
        &self,
        key: &str,
        path: Option<&str>,
        state: &str,
        error: Option<&str>,
    ) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "UPDATE downloads SET path = ?2, state = ?3, error = ?4
                 WHERE track_id = (SELECT id FROM tracks WHERE provider_key = ?1)",
                params![key, path, state, error],
            )?;
            Ok(())
        })
    }

    /// 从磁盘重建时只知道文件名。曲目不在库里就补一条最小记录，
    /// 免得用户删掉的条目下次启动又被扫回来。
    pub fn adopt_download(&self, key: &TrackKey, title: &str, path: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO tracks (provider_key, title) VALUES (?1, ?2)
                 ON CONFLICT(provider_key) DO NOTHING",
                params![key.as_opaque(), title],
            )?;
            conn.execute(
                "INSERT INTO downloads (track_id, path, state)
                 VALUES ((SELECT id FROM tracks WHERE provider_key = ?1), ?2, 'done')
                 ON CONFLICT(track_id) DO UPDATE SET
                   path = excluded.path,
                   state = excluded.state,
                   error = NULL,
                   created_at = unixepoch() * 1000",
                params![key.as_opaque(), path],
            )?;
            Ok(())
        })
    }

    pub fn downloads(&self) -> Result<Vec<StoredDownload>> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT t.provider_key, t.title, d.path, d.state, d.error
                 FROM downloads d JOIN tracks t ON t.id = d.track_id
                 ORDER BY d.created_at, d.track_id",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(StoredDownload {
                    key: TrackKey::from_provider(row.get::<_, String>(0)?),
                    title: row.get(1)?,
                    path: row.get(2)?,
                    state: row.get(3)?,
                    error: row.get(4)?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn rekey_download(&self, from: &str, to: &str) -> Result<()> {
        let mut conn = self.conn.lock().expect("数据库连接被毒化");
        let tx = conn.transaction()?;
        let source: i64 = tx.query_row(
            "SELECT id FROM tracks WHERE provider_key = ?1",
            [from],
            |row| row.get(0),
        )?;
        let target: Option<i64> = tx
            .query_row(
                "SELECT id FROM tracks WHERE provider_key = ?1",
                [to],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(target) = target {
            let download_path = |id| {
                tx.query_row(
                    "SELECT path FROM downloads WHERE track_id = ?1",
                    [id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
            };
            let on_disk =
                |path: Option<String>| path.is_some_and(|path| Path::new(&path).is_file());
            let target_path = download_path(target)?;
            let keep_source = target_path.is_none()
                || (on_disk(download_path(source)?.flatten()) && !on_disk(target_path.flatten()));
            if keep_source {
                tx.execute("DELETE FROM downloads WHERE track_id = ?1", [target])?;
                tx.execute(
                    "UPDATE downloads SET track_id = ?2 WHERE track_id = ?1",
                    params![source, target],
                )?;
            } else {
                tx.execute("DELETE FROM downloads WHERE track_id = ?1", [source])?;
            }
        } else {
            tx.execute(
                "UPDATE tracks SET provider_key = ?2 WHERE id = ?1",
                params![source, to],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_download(&self, key: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "DELETE FROM downloads
                 WHERE track_id = (SELECT id FROM tracks WHERE provider_key = ?1)",
                params![key],
            )?;
            Ok(())
        })
    }
}

fn row_to_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    let provider_key: String = row.get(0)?;
    let duration_ms: Option<i64> = row.get(4)?;
    Ok(Track {
        key: TrackKey::from_provider(provider_key),
        title: row.get(1)?,
        artist: row.get(2)?,
        duration: duration_ms.map(|d| Millis(d as u64)),
        cover: row.get(3)?,
        accent: None,
        views: None,
        danmaku: None,
        up_avatar: row.get(5)?,
        up_mid: row.get::<_, Option<i64>>(6)?.map(|v| v as u64),
        tname: None,
        typeid: None,
    })
}

fn row_to_reaction(row: &rusqlite::Row<'_>) -> rusqlite::Result<Reaction> {
    let kind: String = row.get(2)?;
    let state: String = row.get(4)?;
    Ok(Reaction {
        track_id: TrackId(row.get(0)?),
        mid: row.get::<_, i64>(1)? as u64,
        kind: if kind == "like" {
            ReactionKind::Like
        } else {
            ReactionKind::Fav
        },
        want: row.get::<_, i32>(3)? != 0,
        state: match state.as_str() {
            "synced" => ReactionState::Synced,
            "rejected" => ReactionState::Rejected,
            "stale" => ReactionState::Stale,
            _ => ReactionState::Pending,
        },
        attempts: row.get::<_, i64>(5)? as u32,
        version: row.get(6)?,
    })
}

/// `row_to_track` 认的列顺序。六处查询共用，加列时只改这一行。
const TRACK_COLUMNS: &str = "provider_key, title, artist, cover, duration_ms, up_avatar, up_mid";

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

enum Migration {
    Sql(&'static str),
    CompleteV4TrackMetadata,
}

impl Migration {
    fn apply(&self, tx: &Transaction<'_>) -> rusqlite::Result<()> {
        match self {
            Self::Sql(sql) => tx.execute_batch(sql),
            Self::CompleteV4TrackMetadata => complete_v4_track_metadata(tx),
        }
    }
}

/// 只追加。已经发布的迁移不许改，改了会让老用户的库停在半路。
const MIGRATIONS: [Migration; 7] = [
    Migration::Sql(
        r#"
CREATE TABLE tracks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  artist       TEXT NOT NULL DEFAULT '',
  cover        TEXT,
  duration_ms  INTEGER,
  accent_rgb   INTEGER,
  fetched_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_key   INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  sort_key    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX idx_pt_order ON playlist_tracks(playlist_id, sort_key);

CREATE TABLE history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL
);
CREATE INDEX idx_history_time ON history(played_at DESC);

CREATE TABLE reactions (
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  mid         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  want        INTEGER NOT NULL,
  state       TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  synced_at   INTEGER,
  PRIMARY KEY (track_id, mid, kind)
);
CREATE INDEX idx_reactions_pending ON reactions(mid, state);

CREATE TABLE downloads (
  track_id    INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  path        TEXT,
  state       TEXT NOT NULL,
  bytes_done  INTEGER NOT NULL DEFAULT 0,
  bytes_total INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE lyrics (
  track_id   INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  doc_json   TEXT NOT NULL,
  source     TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#,
    ),
    Migration::Sql(
        r#"
-- v2：队列快照。队列本身是上下文，重启恢复到离开时的样子。
CREATE TABLE queue_snapshot (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  payload  TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
"#,
    ),
    Migration::Sql(
        r#"
-- v3：同一首歌在历史里只留一条。
--
-- 以前每播一次插一行，于是「继续听」里同一个视频能重复四遍。
-- 历史是「这个视频我上次看到哪」，不是流水账，按 track 唯一才对。
DELETE FROM history WHERE id NOT IN (
  SELECT MAX(id) FROM history GROUP BY track_id
);
CREATE UNIQUE INDEX idx_history_track ON history(track_id);
"#,
    ),
    Migration::CompleteV4TrackMetadata,
    Migration::Sql(
        r#"
-- v5：历史要记「看到哪了」。B 站的历史卡片底下有一条播放进度，
-- 只有时间没有位置的话，卡片永远看起来像没看过。
ALTER TABLE history ADD COLUMN position_ms INTEGER NOT NULL DEFAULT 0;
"#,
    ),
    Migration::Sql(
        r#"
-- v6：下载失败要能说明为什么，重启后仍给出同一条信息。
ALTER TABLE downloads ADD COLUMN error TEXT;
"#,
    ),
    Migration::Sql("ALTER TABLE reactions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;"),
];

fn complete_v4_track_metadata(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    for (column, sql) in [
        ("up_mid", "ALTER TABLE tracks ADD COLUMN up_mid INTEGER"),
        ("up_avatar", "ALTER TABLE tracks ADD COLUMN up_avatar TEXT"),
    ] {
        let exists: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM pragma_table_info('tracks') WHERE name = ?1)",
            [column],
            |row| row.get(0),
        )?;
        if !exists {
            tx.execute(sql, [])?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(n: &str) -> Track {
        Track {
            key: TrackKey::from_provider(format!("BV{n}")),
            title: format!("歌 {n}"),
            artist: "某人".into(),
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

    fn lib() -> Library {
        Library::open_in_memory().expect("内存库应该能开")
    }

    #[test]
    fn 迁移只跑一次且版本正确() {
        let l = lib();
        assert_eq!(
            l.with(|c| c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)))
                .unwrap(),
            SCHEMA_VERSION
        );
        l.migrate().expect("重复迁移应该无害");
    }

    #[test]
    fn 同一个键永远同一个_id() {
        let l = lib();
        let a = l.upsert_track(&track("1")).unwrap();
        let b = l.upsert_track(&track("1")).unwrap();
        assert_eq!(a, b);
        let c = l.upsert_track(&track("2")).unwrap();
        assert_ne!(a, c);
    }

    #[test]
    fn 头像与_uid_能落库再读回() {
        let l = lib();
        let mut t = track("avatar");
        t.up_mid = Some(42);
        t.up_avatar = Some("https://i0.hdslb.com/face.jpg".into());
        l.upsert_track(&t).unwrap();
        let back = l.track_by_key(&t.key).unwrap().expect("应该读得到");
        assert_eq!(back.up_mid, Some(42));
        assert_eq!(back.up_avatar.as_deref(), Some("https://i0.hdslb.com/face.jpg"));
    }

    #[test]
    fn 后一次写入没有头像时不覆盖已有的() {
        let l = lib();
        let mut t = track("keep-avatar");
        t.up_avatar = Some("https://i0.hdslb.com/a.jpg".into());
        l.upsert_track(&t).unwrap();
        // 历史落库路径里的 Track 可能没有头像，不能把已有的冲掉。
        let mut bare = track("keep-avatar");
        bare.up_avatar = None;
        l.upsert_track(&bare).unwrap();
        let back = l.track_by_key(&t.key).unwrap().unwrap();
        assert_eq!(back.up_avatar.as_deref(), Some("https://i0.hdslb.com/a.jpg"));
    }

    #[test]
    fn 键集分页不跳行() {
        let l = lib();
        for i in 0..5 {
            l.upsert_track(&track(&i.to_string())).unwrap();
        }
        let first = l.page_tracks(None, 2).unwrap();
        assert_eq!(first.len(), 2);
        let cursor = PageCursor::from_store("2");
        let second = l.page_tracks(Some(&cursor), 2).unwrap();
        assert_eq!(second.len(), 2);
        assert_ne!(first[0].key, second[0].key);
    }

    #[test]
    fn 歌单重排只改一行且顺序正确() {
        let l = lib();
        let p = l.create_playlist("测试").unwrap();
        let ids: Vec<TrackId> = (0..3)
            .map(|i| l.upsert_track(&track(&i.to_string())).unwrap())
            .collect();
        for id in &ids {
            l.add_to_playlist(p.id, *id).unwrap();
        }
        // 把第三首挪到最前面
        l.reorder_playlist(p.id, ids[2], Some(ids[0])).unwrap();
        let list = l.playlist_tracks(p.id).unwrap();
        let titles: Vec<&str> = list.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["歌 2", "歌 0", "歌 1"]);
    }

    #[test]
    fn 歌单名不能为空() {
        let l = lib();
        assert!(l.create_playlist("  ").is_err());
    }

    #[test]
    fn 取消喜欢是保留意图而不是删行() {
        let l = lib();
        let id = l.upsert_track(&track("1")).unwrap();
        l.set_reaction(id, 42, ReactionKind::Like, true).unwrap();
        assert_eq!(l.pending_reactions(42, 10).unwrap().len(), 1);

        l.set_reaction(id, 42, ReactionKind::Like, false).unwrap();
        let pending = l.pending_reactions(42, 10).unwrap();
        assert_eq!(pending.len(), 1);
        assert!(!pending[0].want, "取消应该仍然是一条待推意图");
    }

    #[test]
    fn 旧同步回执保留最新取消意图() {
        let dir = temp_dir("stale-reaction-receipt");
        let l = Library::open(&dir.join("library.sqlite")).unwrap();
        let id = l.upsert_track(&track("BVstale")).unwrap();
        l.set_reaction(id, 42, ReactionKind::Like, true).unwrap();
        let sent = l.pending_reactions(42, 10).unwrap().remove(0);

        l.set_reaction(id, 42, ReactionKind::Like, false).unwrap();
        l.mark_reaction(&sent, ReactionState::Synced).unwrap();
        let pending = l.pending_reactions(42, 10).unwrap();
        let stored = l
            .with(|conn| {
                conn.query_row(
                    "SELECT want, state FROM reactions WHERE track_id = ?1",
                    [id.0],
                    |row| Ok((row.get::<_, bool>(0)?, row.get::<_, String>(1)?)),
                )
            })
            .unwrap();

        drop(l);
        std::fs::remove_dir_all(dir).unwrap();
        assert_eq!(stored, (false, "pending".into()));
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn 取消再喜欢后只有最新版本的回执能完成同步() {
        let dir = temp_dir("reaction-version");
        let l = Library::open(&dir.join("library.sqlite")).unwrap();
        let id = l.upsert_track(&track("BVversion")).unwrap();
        l.set_reaction(id, 42, ReactionKind::Like, true).unwrap();
        let sent = l.pending_reactions_all(42).unwrap().remove(0);

        let cancelled = l.set_reaction(id, 42, ReactionKind::Like, false).unwrap();
        let latest = l.set_reaction(id, 42, ReactionKind::Like, true).unwrap();
        assert!(sent.version < cancelled.version && cancelled.version < latest.version);

        l.mark_reaction(&sent, ReactionState::Synced).unwrap();
        l.mark_reaction(&cancelled, ReactionState::Rejected).unwrap();
        assert_eq!(l.pending_reactions_all(42).unwrap(), vec![latest.clone()]);

        l.mark_reaction(&latest, ReactionState::Synced).unwrap();
        assert!(l.pending_reactions_all(42).unwrap().is_empty());
        let repeated = l.set_reaction(id, 42, ReactionKind::Like, true).unwrap();
        assert!(latest.version < repeated.version);
        assert_eq!(repeated.state, ReactionState::Synced);

        drop(l);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn 可重试失败留在待办_永久拒绝才移除() {
        let l = lib();
        let id = l.upsert_track(&track("BVretry")).unwrap();
        l.set_reaction(id, 42, ReactionKind::Like, true).unwrap();

        let first = l.pending_reactions(42, 10).unwrap();
        assert_eq!(first.len(), 1);
        l.mark_reaction(&first[0], ReactionState::Pending).unwrap();
        let again = l.pending_reactions(42, 10).unwrap();
        assert_eq!(again.len(), 1, "可重试失败不能从待办里消失");
        assert_eq!(again[0].attempts, 1, "重试次数要累加，下一次轮转到后面的待办");

        l.mark_reaction(&again[0], ReactionState::Rejected).unwrap();
        assert!(
            l.pending_reactions(42, 10).unwrap().is_empty(),
            "永久拒绝不再重试"
        );
    }

    #[test]
    fn 全部待办一次取完不受批次上限影响() {
        let l = lib();
        for n in 0..21 {
            let id = l.upsert_track(&track(&n.to_string())).unwrap();
            l.set_reaction(id, 42, ReactionKind::Like, n % 2 == 0).unwrap();
        }
        assert_eq!(l.pending_reactions(42, 20).unwrap().len(), 20);
        assert_eq!(l.pending_reactions_all(42).unwrap().len(), 21);
    }

    #[test]
    fn 换号后旧账号的待推项被标成过期() {
        let l = lib();
        let id = l.upsert_track(&track("1")).unwrap();
        l.set_reaction(id, 1, ReactionKind::Like, true).unwrap();
        l.set_reaction(id, 2, ReactionKind::Like, true).unwrap();

        let changed = l.mark_accounts_stale(2).unwrap();
        assert_eq!(changed, 1);
        assert_eq!(l.pending_reactions(2, 10).unwrap().len(), 1);
        assert_eq!(l.pending_reactions(1, 10).unwrap().len(), 0);
    }

    #[test]
    fn 队列快照能覆盖写入() {
        let l = lib();
        assert_eq!(l.load_queue().unwrap(), None);
        l.save_queue(r#"["BV1","BV2"]"#).unwrap();
        l.save_queue(r#"["BV3"]"#).unwrap();
        assert_eq!(l.load_queue().unwrap().as_deref(), Some(r#"["BV3"]"#));
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "bilimusic-store-{tag}-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn migration_fixture(path: &Path, version: i64) -> Connection {
        let mut conn = Connection::open(path).unwrap();
        let tx = conn.transaction().unwrap();
        for migration in &MIGRATIONS[..version as usize] {
            migration.apply(&tx).unwrap();
        }
        insert_migration_fixture_data(&tx).unwrap();
        tx.pragma_update(None, "user_version", version).unwrap();
        tx.commit().unwrap();
        conn
    }

    fn insert_migration_fixture_data(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "INSERT INTO tracks (id, provider_key, title) VALUES (4, 'BVlegacy', '旧曲目');
             INSERT INTO playlists (id, name, sort_key) VALUES (7, '旧歌单', 1024);
             INSERT INTO playlist_tracks (playlist_id, track_id, sort_key) VALUES (7, 4, 1024);
             INSERT INTO history (id, track_id, played_at) VALUES (9, 4, 1234);",
        )
    }

    fn open_and_check_migrated_library(path: &Path) -> Result<()> {
        let library = Library::open(path)?;
        assert_eq!(
            library.with(|conn| {
                conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            })?,
            SCHEMA_VERSION
        );
        assert_eq!(
            library.playlists()?,
            vec![Playlist {
                id: 7,
                name: "旧歌单".into(),
                sort_key: 1024,
            }]
        );
        let tracks = library.playlist_tracks(7)?;
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].key.as_opaque(), "BVlegacy");
        let history = library.history_with_time(10, None)?;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].0.key.as_opaque(), "BVlegacy");
        assert_eq!((history[0].1, history[0].2, history[0].3), (1234, 0, 9));
        Ok(())
    }

    #[test]
    fn 迁移_第六版待同步意图仍可同步() {
        let dir = temp_dir("migrate-v6-reactions");
        let db = dir.join("library.sqlite");
        {
            let conn = migration_fixture(&db, 6);
            conn.execute(
                "INSERT INTO reactions (track_id, mid, kind, want, attempts)
                 VALUES (4, 42, 'fav', 0, 2)",
                [],
            )
            .unwrap();
        }

        let l = Library::open(&db).unwrap();
        let pending = l.pending_reactions_all(42).unwrap();
        assert_eq!(pending.len(), 1);
        let reaction = &pending[0];
        assert_eq!(reaction.track_id, TrackId(4));
        assert_eq!(reaction.kind, ReactionKind::Fav);
        assert!(!reaction.want);
        assert_eq!(reaction.attempts, 2);
        assert_eq!(reaction.version, 0);
        l.mark_reaction(reaction, ReactionState::Synced).unwrap();
        assert!(l.pending_reactions_all(42).unwrap().is_empty());

        drop(l);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn 迁移_中断在第四版第一列后仍能重开() {
        let dir = temp_dir("migrate-v4-interrupted");
        let db = dir.join("library.sqlite");
        {
            let conn = migration_fixture(&db, 3);
            conn.execute("ALTER TABLE tracks ADD COLUMN up_mid INTEGER", [])
                .unwrap();
        }

        let first = open_and_check_migrated_library(&db);
        let second = open_and_check_migrated_library(&db);
        std::fs::remove_dir_all(dir).unwrap();
        assert!(
            first.is_ok() && second.is_ok(),
            "两次打开都应成功。第一次 {first:?}，第二次 {second:?}"
        );
    }

    #[test]
    fn 迁移_正常第三版升级保留歌单和历史() {
        let dir = temp_dir("migrate-v3");
        let db = dir.join("library.sqlite");
        drop(migration_fixture(&db, 3));

        open_and_check_migrated_library(&db).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn 迁移_第四版已加两列但版本未更新仍能重开() {
        let dir = temp_dir("migrate-v4-before-version");
        let db = dir.join("library.sqlite");
        {
            let conn = migration_fixture(&db, 3);
            conn.execute_batch(
                "ALTER TABLE tracks ADD COLUMN up_mid INTEGER;
                 ALTER TABLE tracks ADD COLUMN up_avatar TEXT;",
            )
            .unwrap();
        }

        open_and_check_migrated_library(&db).unwrap();
        open_and_check_migrated_library(&db).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn 迁移_当前版重开保留结构及数据() {
        let dir = temp_dir("migrate-current");
        let db = dir.join("library.sqlite");
        let schema_version: i64 = {
            let library = Library::open(&db).unwrap();
            library.with(insert_migration_fixture_data).unwrap();
            library
                .with(|conn| conn.pragma_query_value(None, "schema_version", |row| row.get(0)))
                .unwrap()
        };

        open_and_check_migrated_library(&db).unwrap();
        let schema_after_reopen: i64 = {
            let conn = Connection::open(&db).unwrap();
            conn.pragma_query_value(None, "schema_version", |row| row.get(0))
                .unwrap()
        };
        assert_eq!(schema_after_reopen, schema_version);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn 迁移_中途失败回滚已执行的语句() {
        let dir = temp_dir("migrate-rollback");
        let db = dir.join("library.sqlite");
        {
            let conn = migration_fixture(&db, 2);
            conn.execute_batch(
                "INSERT INTO history (id, track_id, played_at) VALUES (10, 4, 5678);
                 CREATE INDEX idx_history_track ON history(played_at);",
            )
            .unwrap();
        }

        let error = Library::open(&db)
            .err()
            .expect("第三版迁移应在建索引时失败");
        assert!(error
            .to_string()
            .contains("index idx_history_track already exists"));
        {
            let conn = Connection::open(&db).unwrap();
            let version: i64 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            let history_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
                .unwrap();
            assert_eq!((version, history_count), (2, 2));
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn 下载记录与错误跨重开保留() {
        let dir = temp_dir("downloads");
        let db = dir.join("library.sqlite");
        let audio = dir.join("晴天 [BV1xx411c7mD].m4a");
        std::fs::write(&audio, b"audio").unwrap();

        {
            let l = Library::open(&db).unwrap();
            l.save_download(
                &track("done"),
                Some(audio.to_str().unwrap()),
                "done",
                None,
            )
            .unwrap();
            l.save_download(&track("failed"), None, "failed", Some("yt-dlp 退出 1"))
                .unwrap();
        }

        let l = Library::open(&db).unwrap();
        let rows = l.downloads().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].key.as_opaque(), "BVdone");
        assert_eq!(rows[0].path.as_deref(), audio.to_str());
        assert_eq!(rows[0].state, "done");
        assert_eq!(rows[0].error, None);
        assert_eq!(rows[1].state, "failed");
        assert_eq!(rows[1].error.as_deref(), Some("yt-dlp 退出 1"));

        l.delete_download("BVdone").unwrap();
        assert_eq!(l.downloads().unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 从磁盘补录的下载能读回也能删掉() {
        let dir = temp_dir("adopt");
        let db = dir.join("library.sqlite");
        let path = dir.join("未知曲目 [BV1xx411c7mD].m4a");
        let l = Library::open(&db).unwrap();
        let key = TrackKey::from_provider("BV1xx411c7mD");
        l.adopt_download(&key, "未知曲目", path.to_str().unwrap())
            .unwrap();

        let rows = l.downloads().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "未知曲目");
        assert_eq!(rows[0].state, "done");

        l.delete_download("BV1xx411c7mD").unwrap();
        assert!(l.downloads().unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 五版旧库升级会补上下载错误列() {
        let dir = temp_dir("migrate-v5");
        let db = dir.join("library.sqlite");
        drop(migration_fixture(&db, 5));

        let l = Library::open(&db).unwrap();
        let columns = l
            .with(|conn| {
                let mut stmt = conn.prepare("PRAGMA table_info(downloads)")?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        assert!(
            columns.iter().any(|name| name == "error"),
            "v6 应该给 downloads 补 error 列，实际列：{columns:?}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 历史可以删单条与清空() {
        let l = lib();
        let a = l.upsert_track(&track("BV1a")).unwrap();
        let b = l.upsert_track(&track("BV1b")).unwrap();
        l.push_history(a, 0).unwrap();
        l.push_history(b, 0).unwrap();
        // 真正的播放之间隔着秒，这里也要隔开一毫秒，否则 played_at 并列看不出顺序。
        std::thread::sleep(std::time::Duration::from_millis(2));
        l.push_history(a, 0).unwrap();
        // 同一个视频只留一条，重播的是把时间往前挪。
        let repeated = l.history(10).unwrap();
        assert_eq!(repeated.len(), 2);
        assert_eq!(repeated[0].key.as_opaque(), "BVBV1a", "重播过的排在最前");

        let key = track("BV1a").key.as_opaque().to_string();
        let n = l.delete_history(&key).unwrap();
        assert!(n >= 1, "BV1a 至少删掉一条，实际 {n}");
        assert_eq!(l.history(10).unwrap().len(), 1, "删掉 a 之后只剩 b");

        l.clear_history().unwrap();
        assert_eq!(l.history(10).unwrap().len(), 0);
    }

    #[test]
    fn 队列快照能带进度() {
        let l = lib();
        l.save_queue(r#"{"keys":["BV1"],"index":0,"position_ms":90362}"#).unwrap();
        let raw = l.load_queue().unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["position_ms"], 90362);
    }

    #[test]
    fn 设置可以覆盖() {
        let l = lib();
        assert_eq!(l.get_setting("volume").unwrap(), None);
        l.set_setting("volume", "0.5").unwrap();
        l.set_setting("volume", "0.8").unwrap();
        assert_eq!(l.get_setting("volume").unwrap().as_deref(), Some("0.8"));
    }

    #[test]
    fn 历史位置能回写() {
        let l = lib();
        let a = l.upsert_track(&track("BVpos")).unwrap();
        l.push_history(a, 0).unwrap();
        l.set_history_position("BVBVpos", 42_500).unwrap();
        let rows = l.history_with_time(10, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].2, 42_500, "回写之后读到的应该是新位置");
    }

    #[test]
    fn 历史按播放时间和_id_翻页_不重复不跳过() {
        let l = lib();
        // 倒序写入，让 A/B 成为最新两条，C/D 更早。
        for key in ["BVpage4", "BVpage3", "BVpage2", "BVpage1"] {
            let id = l.upsert_track(&track(key)).unwrap();
            l.push_history(id, 0).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let first = l.history_with_time(2, None).unwrap();
        assert_eq!(first.len(), 2);
        let cursor = (first[1].1, first[1].3);

        // 把 D 重新播一次，它会跳到最前；旧的 B 游标仍应只带出 C。
        let d = l.upsert_track(&track("BVpage4")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        l.push_history(d, 0).unwrap();
        let older = l.history_with_time(2, Some(cursor)).unwrap();
        assert_eq!(older.len(), 1, "D 跳到最前后，C 仍应可读");
        assert_eq!(older[0].0.key.as_opaque(), "BVBVpage3");
        assert!(
            !older.iter().any(|row| row.0.key.as_opaque() == "BVBVpage2"),
            "B 已经在上一页，不能重复"
        );
    }

    #[test]
    fn 重开时零位置不覆盖已看进度() {
        let l = lib();
        let a = l.upsert_track(&track("BVresume")).unwrap();
        l.push_history(a, 0).unwrap();
        l.set_history_position("BVBVresume", 42_500).unwrap();
        // 重新打开视频时先写一条 0 历史，不能把续播点清掉。
        l.push_history(a, 0).unwrap();
        assert_eq!(l.history_position("BVBVresume").unwrap(), Some(42_500));
    }

    #[test]
    fn 批量历史进度只返回问到的键() {
        let l = lib();
        for (n, position) in [("batch1", 11_000), ("batch2", 22_000)] {
            let id = l.upsert_track(&track(n)).unwrap();
            l.push_history(id, 0).unwrap();
            l.set_history_position(&format!("BV{n}"), position).unwrap();
        }
        let rows = l
            .history_positions(&["BVbatch1".into(), "BVmissing".into()])
            .unwrap();
        assert_eq!(rows, vec![("BVbatch1".to_string(), 11_000)]);
        assert!(l.history_positions(&[]).unwrap().is_empty());
    }

    #[test]
    fn 历史按时间倒序() {
        let l = lib();
        let a = l.upsert_track(&track("1")).unwrap();
        let b = l.upsert_track(&track("2")).unwrap();
        l.push_history(a, 0).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        l.push_history(b, 0).unwrap();
        let h = l.history(10).unwrap();
        assert_eq!(h[0].title, "歌 2");
    }
}
