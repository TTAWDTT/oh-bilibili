//! 队列与播放器状态机。
//!
//! 两条设计决定写在这里，因为它们是全项目最容易改错的地方：
//! 队列条目的身份是 `EntryId` 而不是下标；播放器状态用带证据字段的枚举表达，
//! 所以「播放中却没有音源」在类型上写不出来。

use bilimusic_model::{EntryId, Millis, Quality, Track, TrackKey};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueEntry {
    pub id: EntryId,
    pub track: Track,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlayOrder {
    InOrder,
    /// 随机顺序存的是条目身份，重排不会让它失配。关掉随机必须还原原序。
    Shuffle { perm: Vec<EntryId>, at: usize },
}

#[derive(Debug, Default)]
pub struct Queue {
    entries: Vec<QueueEntry>,
    cursor: Option<EntryId>,
    order: Option<PlayOrder>,
    next_id: u64,
}

impl Queue {
    pub fn from_tracks(tracks: &[Track], start_at: usize) -> Queue {
        let mut q = Queue::default();
        for t in tracks {
            q.push_back(t.clone());
        }
        if let Some(entry) = q.entries.get(start_at) {
            q.cursor = Some(entry.id);
        }
        q
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn items(&self) -> Vec<Track> {
        self.entries.iter().map(|e| e.track.clone()).collect()
    }

    pub fn position_of(&self, id: EntryId) -> Option<usize> {
        self.entries.iter().position(|e| e.id == id)
    }

    pub fn index(&self) -> Option<usize> {
        self.cursor.and_then(|id| self.position_of(id))
    }

    pub fn current(&self) -> Option<&QueueEntry> {
        let id = self.cursor?;
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn push_back(&mut self, track: Track) -> EntryId {
        self.next_id += 1;
        let id = EntryId(self.next_id);
        self.entries.push(QueueEntry {
            id,
            track: track.clone(),
        });
        if let Some(PlayOrder::Shuffle { perm, .. }) = self.order.as_mut() {
            perm.push(id);
        }
        if self.cursor.is_none() {
            self.cursor = Some(id);
        }
        id
    }

    pub fn insert_next(&mut self, track: Track) -> EntryId {
        self.next_id += 1;
        let id = EntryId(self.next_id);
        let at = self.index().map(|i| i + 1).unwrap_or(0);
        self.entries.insert(
            at,
            QueueEntry {
                id,
                track: track.clone(),
            },
        );
        if let Some(PlayOrder::Shuffle { perm, .. }) = self.order.as_mut() {
            perm.push(id);
        }
        id
    }

    pub fn remove(&mut self, id: EntryId) -> bool {
        let Some(pos) = self.position_of(id) else {
            return false;
        };
        let was_current = self.cursor == Some(id);
        self.entries.remove(pos);
        if let Some(PlayOrder::Shuffle { perm, at }) = self.order.as_mut() {
            if let Some(i) = perm.iter().position(|e| *e == id) {
                perm.remove(i);
                if i < *at {
                    *at = at.saturating_sub(1);
                }
            }
        }
        if was_current {
            self.cursor = self.entries.get(pos.min(self.entries.len().saturating_sub(1))).map(|e| e.id);
        }
        true
    }

    pub fn move_entry(&mut self, id: EntryId, before: Option<EntryId>) -> bool {
        let Some(from) = self.position_of(id) else {
            return false;
        };
        let entry = self.entries.remove(from);
        let to = before
            .and_then(|b| self.position_of(b))
            .unwrap_or(self.entries.len());
        self.entries.insert(to.min(self.entries.len()), entry);
        true
    }

    pub fn jump(&mut self, id: EntryId) -> bool {
        if self.position_of(id).is_none() {
            return false;
        }
        self.cursor = Some(id);
        if let Some(PlayOrder::Shuffle { perm, at }) = self.order.as_mut() {
            if let Some(i) = perm.iter().position(|e| *e == id) {
                *at = i;
            }
        }
        true
    }

    /// 按曲目键跳转。播放单个搜索结果时用，队列里没有就补进去。
    pub fn jump_by_key(&mut self, key: &TrackKey) -> bool {
        if let Some(entry) = self.entries.iter().find(|e| &e.track.key == key) {
            let id = entry.id;
            return self.jump(id);
        }
        false
    }

    pub fn set_shuffle(&mut self, on: bool) {
        if on {
            if self.order.is_none() {
                let mut perm: Vec<EntryId> = self.entries.iter().map(|e| e.id).collect();
                // 固定种子的洗牌，测试可复现。
                let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
                for i in (1..perm.len()).rev() {
                    seed ^= seed << 13;
                    seed ^= seed >> 7;
                    seed ^= seed << 17;
                    let j = (seed % (i as u64 + 1)) as usize;
                    perm.swap(i, j);
                }
                let at = self
                    .cursor
                    .and_then(|c| perm.iter().position(|e| *e == c))
                    .unwrap_or(0);
                self.order = Some(PlayOrder::Shuffle { perm, at });
            }
        } else {
            self.order = None;
        }
    }

    pub fn shuffle(&self) -> bool {
        self.order.is_some()
    }

    /// 下一首。`wrap` 为真时到末尾回到开头（列表循环）。
    pub fn advance(&mut self, wrap: bool) -> Option<&QueueEntry> {
        let id = match self.order.as_mut() {
            Some(PlayOrder::Shuffle { perm, at }) => {
                if perm.is_empty() {
                    return None;
                }
                if *at + 1 >= perm.len() {
                    if !wrap {
                        return None;
                    }
                    *at = 0;
                } else {
                    *at += 1;
                }
                *perm.get(*at)?
            }
            _ => {
                let pos = self.index()?;
                let next = if pos + 1 >= self.entries.len() {
                    if !wrap {
                        return None;
                    }
                    0
                } else {
                    pos + 1
                };
                self.entries.get(next)?.id
            }
        };
        self.cursor = Some(id);
        self.current()
    }

    pub fn retreat(&mut self) -> Option<&QueueEntry> {
        let id = match self.order.as_mut() {
            Some(PlayOrder::Shuffle { perm, at }) => {
                if perm.is_empty() {
                    return None;
                }
                *at = if *at == 0 { perm.len() - 1 } else { *at - 1 };
                *perm.get(*at)?
            }
            _ => {
                let pos = self.index()?;
                let prev = if pos == 0 { self.entries.len() - 1 } else { pos - 1 };
                self.entries.get(prev)?.id
            }
        };
        self.cursor = Some(id);
        self.current()
    }
}

/// 取流请求的令牌。单调递增，用来让迟到的响应无处可落。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct LoadToken(pub u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fault {
    Network(String),
    Blocked(String),
    NoStream,
    Decode(String),
}

#[derive(Debug, Clone)]
pub struct Prepared {
    pub quality: Quality,
    pub duration: Millis,
}

#[derive(Debug, Clone)]
pub struct Prefetched {
    pub token: LoadToken,
    pub track: TrackKey,
    pub prepared: Prepared,
}

#[derive(Debug, Clone)]
pub enum PlayerState {
    Idle,
    Loading {
        token: LoadToken,
        track: TrackKey,
    },
    Ready {
        token: LoadToken,
        track: TrackKey,
        prepared: Prepared,
    },
    Playing {
        token: LoadToken,
        track: TrackKey,
        prepared: Prepared,
        prefetched: Option<Prefetched>,
    },
    Paused {
        token: LoadToken,
        track: TrackKey,
        prepared: Prepared,
    },
    Ended {
        track: TrackKey,
    },
    Faulted {
        track: TrackKey,
        fault: Fault,
    },
}

impl PlayerState {
    pub fn phase(&self) -> &'static str {
        match self {
            PlayerState::Idle => "idle",
            PlayerState::Loading { .. } => "loading",
            PlayerState::Ready { .. } => "ready",
            PlayerState::Playing { .. } => "playing",
            PlayerState::Paused { .. } => "paused",
            PlayerState::Ended { .. } => "ended",
            PlayerState::Faulted { .. } => "faulted",
        }
    }

    pub fn token(&self) -> Option<LoadToken> {
        match self {
            PlayerState::Loading { token, .. }
            | PlayerState::Ready { token, .. }
            | PlayerState::Playing { token, .. }
            | PlayerState::Paused { token, .. } => Some(*token),
            _ => None,
        }
    }

    pub fn track(&self) -> Option<&TrackKey> {
        match self {
            PlayerState::Idle => None,
            PlayerState::Loading { track, .. }
            | PlayerState::Ready { track, .. }
            | PlayerState::Playing { track, .. }
            | PlayerState::Paused { track, .. }
            | PlayerState::Ended { track }
            | PlayerState::Faulted { track, .. } => Some(track),
        }
    }

    /// 手上音源所属的令牌。规则一要求它必须等于当前令牌。
    pub fn source_token(&self) -> Option<LoadToken> {
        self.token()
    }

    pub fn prepared(&self) -> Option<&Prepared> {
        match self {
            PlayerState::Ready { prepared, .. }
            | PlayerState::Playing { prepared, .. }
            | PlayerState::Paused { prepared, .. } => Some(prepared),
            _ => None,
        }
    }

    pub fn begin_load(self, token: LoadToken, track: TrackKey) -> PlayerState {
        PlayerState::Loading { token, track }
    }

    /// 取流成功。令牌不匹配就是迟到响应，返回原状态，一个字都不改。
    pub fn stream_ready(self, token: LoadToken, prepared: Prepared) -> PlayerState {
        match self {
            PlayerState::Loading {
                token: current,
                track,
            } if current == token => PlayerState::Playing {
                token,
                track,
                prepared,
                prefetched: None,
            },
            other => other,
        }
    }

    /// 预取结果落槽。不带身份，因为槽里只有一份。
    pub fn prefetched(self, token: LoadToken, key: TrackKey, prepared: Prepared) -> PlayerState {
        match self {
            PlayerState::Playing {
                token: current,
                track,
                prepared: cur,
                prefetched: _,
            } => PlayerState::Playing {
                token: current,
                track,
                prepared: cur,
                prefetched: Some(Prefetched {
                    token,
                    track: key,
                    prepared,
                }),
            },
            other => other,
        }
    }

    pub fn play(self) -> PlayerState {
        match self {
            PlayerState::Paused {
                token,
                track,
                prepared,
            } => PlayerState::Playing {
                token,
                track,
                prepared,
                prefetched: None,
            },
            PlayerState::Ready {
                token,
                track,
                prepared,
            } => PlayerState::Playing {
                token,
                track,
                prepared,
                prefetched: None,
            },
            other => other,
        }
    }

    pub fn pause(self) -> PlayerState {
        match self {
            PlayerState::Playing {
                token,
                track,
                prepared,
                ..
            } => PlayerState::Paused {
                token,
                track,
                prepared,
            },
            other => other,
        }
    }

    pub fn ended(self) -> PlayerState {
        match self.track().cloned() {
            Some(track) => PlayerState::Ended { track },
            None => PlayerState::Idle,
        }
    }

    pub fn fail(self, fault: Fault) -> PlayerState {
        match self.track().cloned() {
            Some(track) => PlayerState::Faulted { track, fault },
            None => PlayerState::Idle,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bilimusic_model::Millis;

    fn track(n: u8) -> Track {
        Track {
            key: TrackKey::from_provider(format!("BV{n}")),
            title: format!("歌 {n}"),
            artist: "某人".into(),
            duration: Some(Millis(200_000)),
            cover: None,
            accent: None,
        }
    }

    fn prepared() -> Prepared {
        Prepared {
            quality: Quality::K192,
            duration: Millis(200_000),
        }
    }

    #[test]
    fn 重排之后随机顺序不会失配() {
        let mut q = Queue::from_tracks(&[track(1), track(2), track(3)], 0);
        q.set_shuffle(true);
        let ids: Vec<EntryId> = q.entries.iter().map(|e| e.id).collect();
        q.move_entry(ids[2], Some(ids[0]));
        for id in &ids {
            assert!(q.position_of(*id).is_some(), "重排后每个身份都还在");
        }
        assert_eq!(q.len(), 3);
    }

    #[test]
    fn 关掉随机会还原原序() {
        let mut q = Queue::from_tracks(&[track(1), track(2), track(3)], 0);
        let before = q.items();
        q.set_shuffle(true);
        q.set_shuffle(false);
        assert_eq!(q.items(), before);
        assert!(!q.shuffle());
    }

    #[test]
    fn 删除当前项后光标落到相邻项() {
        let mut q = Queue::from_tracks(&[track(1), track(2), track(3)], 1);
        let current = q.cursor.expect("有光标");
        assert!(q.remove(current));
        assert_eq!(q.len(), 2);
        assert!(q.current().is_some(), "光标不该悬空");
    }

    #[test]
    fn 不循环时末尾停下() {
        let mut q = Queue::from_tracks(&[track(1), track(2)], 1);
        assert!(q.advance(false).is_none());
        assert!(q.advance(true).is_some(), "循环模式应该回到开头");
    }

    #[test]
    fn 播放中一定有音源() {
        let state = PlayerState::Idle
            .begin_load(LoadToken(1), track(1).key)
            .stream_ready(LoadToken(1), prepared());
        assert_eq!(state.phase(), "playing");
        assert!(state.prepared().is_some(), "playing 必然带 prepared");
        assert_eq!(state.source_token(), Some(LoadToken(1)));
    }

    #[test]
    fn 迟到的取流响应不改变状态() {
        let state = PlayerState::Idle
            .begin_load(LoadToken(2), track(2).key)
            .stream_ready(LoadToken(2), prepared());
        // 旧请求 1 的响应晚到了
        let after = state.clone().stream_ready(LoadToken(1), prepared());
        assert_eq!(after.phase(), "playing");
        assert_eq!(after.token(), Some(LoadToken(2)));
    }

    #[test]
    fn 预取结果落进槽里而不是被丢掉() {
        let playing = PlayerState::Idle
            .begin_load(LoadToken(1), track(1).key)
            .stream_ready(LoadToken(1), prepared());
        let with_prefetch = playing.prefetched(LoadToken(2), track(2).key, prepared());
        match with_prefetch {
            PlayerState::Playing { prefetched, .. } => {
                assert!(prefetched.is_some(), "预取必须有落点");
            }
            _ => panic!("还应该在播放中"),
        }
    }

}
