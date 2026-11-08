//! 领域词汇表。
//!
//! 这个 crate 不认识 HTTP、SQL 和声卡。它只做一件事：把不变量编码进类型，
//! 让调用方在拿到一个值时不必再校验。

use serde::{Deserialize, Serialize};

/// 时间轴上的毫秒。歌词时刻、播放进度、时长都用它，不用 f64 秒。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Millis(pub u64);

impl Millis {
    pub const ZERO: Millis = Millis(0);
    pub fn from_secs(secs: f32) -> Millis {
        Millis((secs.max(0.0) * 1000.0).round() as u64)
    }
    pub fn as_secs(self) -> f64 {
        self.0 as f64 / 1000.0
    }
}

/// 墙钟时刻，Unix 毫秒。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp(pub i64);

/// 提供方句柄。调用方只能原样回传，不能拆解。
///
/// 没有 getter 能把里面的字符串取出来当 id 用，所以 `store` 不会长出「解析 bvid」这种知识。
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TrackKey(String);

impl TrackKey {
    /// 铸造入口。只有 provider crate 应该调用它。
    pub fn from_provider(opaque: impl Into<String>) -> TrackKey {
        TrackKey(opaque.into())
    }
    pub fn as_opaque(&self) -> &str {
        &self.0
    }
}

/// 本地主键。由数据库分配，跨会话稳定，与 TrackKey 是两个东西。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TrackId(pub i64);

/// 歌单主键。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlaylistId(pub i64);

/// 队列条目的身份。是身份不是下标，所以重排和随机不会互相踩。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EntryId(pub u64);

/// 音轨档位。闭集且有序，「不低于」是纯代数比较。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Quality {
    K64,
    K132,
    K192,
}

impl Quality {
    pub const BEST: Quality = Quality::K192;

    pub fn kbps(self) -> u16 {
        match self {
            Quality::K64 => 64,
            Quality::K132 => 132,
            Quality::K192 => 192,
        }
    }

    /// 把 B 站的清晰度 id 映射成档位。未知档位返回 None，由调用方决定降级还是拒绝。
    pub fn from_bili_id(id: u32) -> Option<Quality> {
        match id {
            30216 => Some(Quality::K64),
            30232 => Some(Quality::K132),
            30280 => Some(Quality::K192),
            _ => None,
        }
    }
}

/// 封面主色。由 Rust 侧从封面提取，驱动界面色晕。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Accent {
    pub rgb: [u8; 3],
}

/// 一首歌的领域形态。这里没有 bvid、aid、cid、分区和播放量。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Track {
    pub key: TrackKey,
    pub title: String,
    pub artist: String,
    /// 序列化成 `duration_ms`：界面契约用的就是这个字段名，改这里等于改协议。
    #[serde(rename = "duration_ms", skip_serializing_if = "Option::is_none")]
    pub duration: Option<Millis>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent: Option<Accent>,
    /// 播放量。B 站卡片左下角会显示。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub views: Option<u64>,
    /// 弹幕数。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danmaku: Option<u64>,
    /// UP 主头像。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub up_avatar: Option<String>,
    /// 分区名，如「音乐」「鬼畜」。由 typeid 查 B 站固定分区表得到。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tname: Option<String>,
}

/// 音量。构造即夹紧，所以 0.0 到 1.0 这个不变量全应用只维护一处。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Volume(f32);

impl Volume {
    pub const ZERO: Volume = Volume(0.0);
    pub const FULL: Volume = Volume(1.0);

    pub fn new(raw: f32) -> Volume {
        if raw.is_nan() {
            return Volume::FULL;
        }
        Volume(raw.clamp(0.0, 1.0))
    }
    pub fn get(self) -> f32 {
        self.0
    }
}

impl Default for Volume {
    fn default() -> Self {
        Volume(0.7)
    }
}

/// 搜索请求。校验在构造处完成，provider 拿到的一定是合法值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchQuery {
    keyword: String,
    page: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("查询不合法：{0}")]
pub struct QueryError(pub String);

impl SearchQuery {
    pub fn parse(raw: &str, page: u32) -> Result<SearchQuery, QueryError> {
        let keyword = raw.trim().to_string();
        if keyword.is_empty() {
            return Err(QueryError("关键词不能为空".into()));
        }
        if keyword.chars().count() > 80 {
            return Err(QueryError("关键词太长".into()));
        }
        if page == 0 || page > 50 {
            return Err(QueryError("页码超出范围".into()));
        }
        Ok(SearchQuery { keyword, page })
    }
    pub fn keyword(&self) -> &str {
        &self.keyword
    }
    pub fn page(&self) -> u32 {
        self.page
    }
}

/// 分页游标。不透明，UI 只回传不构造。
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PageCursor(String);

impl PageCursor {
    pub fn from_store(encoded: impl Into<String>) -> PageCursor {
        PageCursor(encoded.into())
    }
    pub fn as_opaque(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 音量构造时就夹紧() {
        assert_eq!(Volume::new(-1.0).get(), 0.0);
        assert_eq!(Volume::new(9.0).get(), 1.0);
        assert_eq!(Volume::new(f32::NAN).get(), 1.0);
        assert_eq!(Volume::new(0.42).get(), 0.42);
    }

    #[test]
    fn 档位按码率有序() {
        assert!(Quality::K192 > Quality::K132);
        assert!(Quality::K132 > Quality::K64);
        assert_eq!(Quality::BEST, Quality::K192);
    }

    #[test]
    fn 未知档位不猜() {
        assert_eq!(Quality::from_bili_id(30280), Some(Quality::K192));
        assert_eq!(Quality::from_bili_id(99999), None);
    }

    #[test]
    fn 空关键词被拒() {
        assert!(SearchQuery::parse("   ", 1).is_err());
        assert!(SearchQuery::parse("晴天", 0).is_err());
        assert!(SearchQuery::parse("晴天", 1).is_ok());
    }

    #[test]
    fn 轨道键不可拆解() {
        let k = TrackKey::from_provider("BV1xx411c7mD");
        assert_eq!(k.as_opaque(), "BV1xx411c7mD");
    }
}
