//! 上线形状。命令失败与后台通知共用同一个错误形状，UI 只有一处 switch。

use bilimusic_model::Track;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "class", rename_all = "snake_case")]
pub enum WireError {
    Retryable {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        retry_after_ms: Option<u64>,
    },
    RateLimited {
        message: String,
        retry_after_ms: u64,
    },
    NeedsLogin {
        message: String,
    },
    Input {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        field: Option<String>,
    },
    Internal {
        message: String,
    },
}

impl WireError {
    pub fn input(field: &str, message: impl Into<String>) -> WireError {
        WireError::Input {
            message: message.into(),
            field: Some(field.to_string()),
        }
    }
    pub fn internal(message: impl Into<String>) -> WireError {
        WireError::Internal {
            message: message.into(),
        }
    }
    pub fn message(&self) -> &str {
        match self {
            WireError::Retryable { message, .. }
            | WireError::RateLimited { message, .. }
            | WireError::NeedsLogin { message }
            | WireError::Input { message, .. }
            | WireError::Internal { message } => message,
        }
    }

    pub fn needs_login(message: impl Into<String>) -> WireError {
        WireError::NeedsLogin {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for WireError {}

impl From<bilimusic_bili::error::BiliError> for WireError {
    fn from(e: bilimusic_bili::error::BiliError) -> WireError {
        use bilimusic_bili::error::BiliError as B;
        match e {
            B::Network(m) => WireError::Retryable {
                message: m,
                retry_after_ms: None,
            },
            B::Blocked { status, head } => WireError::Retryable {
                message: format!("B 站返回了拦截页（HTTP {status}）：{head}"),
                retry_after_ms: Some(60_000),
            },
            B::Api { code, message } => WireError::Internal {
                message: format!("接口错误 {code}：{message}"),
            },
            B::RateLimited {
                retry_after,
                message,
            } => WireError::RateLimited {
                message,
                retry_after_ms: retry_after.as_millis() as u64,
            },
            B::NeedsLogin(m) => WireError::NeedsLogin { message: m },
            B::Parse(m) => WireError::Internal { message: m },
        }
    }
}

impl From<bilimusic_store::StoreError> for WireError {
    fn from(e: bilimusic_store::StoreError) -> WireError {
        WireError::Internal {
            message: e.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerSnapshot {
    pub phase: String,
    pub track: Option<Track>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f32,
    /// 播放倍速，0.5..=2.0。
    pub speed: f32,
    pub repeat: String,
    pub shuffle: bool,
    pub quality_kbps: Option<u16>,
    /// 同一个会话的两个渲染目标。看与听共用位置与队列，只有画面这一项不同。
    pub mode: PlayMode,
}

/// 渲染目标。它不属于领域实体，属于会话。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayMode {
    Listen,
    Watch,
}

/// 视频详情视图，字段与 TS 契约逐一对应。
/// 观看页右栏的合集。字段与 TS 契约逐一对应。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SeasonView {
    pub id: u64,
    pub title: String,
    pub episodes: Vec<SeasonEpisodeView>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SeasonEpisodeView {
    pub key: String,
    pub title: String,
    pub cover: Option<String>,
    pub duration_ms: u64,
    pub views: Option<u64>,
    /// 当前正在看的就是这一集。
    pub current: bool,
}

/// 入站必刷。`explain` 是 B 站官方文案，原样透传。
/// 综合热门一页：条目 + 每条 B 站自己印在标题下的橙色小标签（可能是空串）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PopularPage {
    pub items: Vec<PopularItemView>,
    pub no_more: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PopularItemView {
    pub track: Track,
    /// 「百万播放」「7万点赞」这类小标签，没有就是空串。
    pub note: String,
}

/// 首页直播卡。字段直接照接口的展示值，这里不再二次格式化。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveRoomView {
    pub room_id: u64,
    pub title: String,
    pub uname: String,
    pub face: Option<String>,
    pub cover: Option<String>,
    pub area: String,
    pub online: u64,
    /// B 站直播间地址。直播流不能在本机解码，点开交给系统浏览器。
    pub url: String,
}

/// 番剧时间表的一天。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BangumiDayView {
    pub date: String,
    pub weekday: u8,
    pub today: bool,
    pub episodes: Vec<BangumiEpisodeView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BangumiEpisodeView {
    pub season_id: u64,
    pub title: String,
    pub cover: Option<String>,
    pub pub_index: String,
    pub pub_time: String,
    pub url: String,
}

/// 首页番剧卡。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BangumiView {
    pub season_id: u64,
    pub title: String,
    pub cover: Option<String>,
    pub rank: u32,
    pub rating: String,
    pub index_show: String,
    pub play_text: String,
    pub url: String,
}

/// 每周必看的一期（列表用）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WeeklyIssueView {
    pub number: u32,
    pub subject: String,
    pub name: String,
}

/// 每周必看某一期的片单。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WeeklyPage {
    pub subject: String,
    pub label: String,
    pub tracks: Vec<Track>,
    /// 每条的推荐语，按曲目 key 对齐；B 站没给的条目不在表里。
    pub notes: std::collections::HashMap<String, String>,
}

/// `PreciousItemView` 故意不带 `Default`：`Track` 没有默认值，编不出来。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PreciousView {
    pub title: String,
    pub explain: String,
    pub items: Vec<PreciousItemView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreciousItemView {
    pub track: Track,
    /// 这条视频的推荐语。
    pub note: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct VideoMetaView {
    pub desc: String,
    pub pubdate: i64,
    pub views: u64,
    pub danmaku: u64,
    pub replies: u64,
    pub favorites: u64,
    pub coins: u64,
    pub shares: u64,
    pub likes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueueView {
    pub items: Vec<Track>,
    pub index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthUser {
    pub mid: u64,
    pub uname: String,
    pub avatar: Option<String>,
    pub level: u8,
    pub coins: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthSnapshot {
    pub logged_in: bool,
    pub user: Option<AuthUser>,
}

/// 观看页显示的统计。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct WatchStats {
    pub views: u64,
    pub danmaku: u64,
    pub likes: u64,
    pub coins: u64,
    pub favorites: u64,
    pub shares: u64,
    pub replies: u64,
}

/// 评论。领域类型定义在 bili crate 的解析边界旁，这里只做重导出，
/// 免得同一份结构写两遍、改一处漏一处。
pub use bilimusic_bili::comments::{Comment, CommentPage};
pub use bilimusic_bili::sync::Followed;

/// 观看页一次调用拿到的全部东西。前端看不到任何远端地址。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchView {
    pub key: String,
    /// 视频简介。
    pub desc: String,
    /// UP 主昵称与 uid。
    pub owner: String,
    pub owner_mid: Option<u64>,
    /// UP 主头像。观看页的 track 是从列表点进来的，那一路没有头像，
    /// 只有详情里有，所以单独给一个字段。
    pub owner_avatar: Option<String>,
    /// 汇总统计。
    pub stats: WatchStats,
    /// 投稿时间（Unix 秒）。B 站视频页把日期写在播放/弹幕那一行后面。
    pub pubdate: i64,
    /// 分区名，例如「游戏」。列表接口不一定带，所以是可选的。
    pub tname: Option<String>,
    /// 分P 列表，单 P 视频只有一条。
    pub pages: Vec<bilimusic_bili::PageRef>,
    /// 当前在放的分P 序号（从 1 开始）。
    pub current_page: u32,
    /// 所属合集；没有合集时为空。
    pub season: Option<SeasonView>,
    /// 清单的完整地址，已经带上本机代理端口。
    pub manifest_url: String,
    pub duration_ms: u64,
    pub qualities: Vec<crate::dash_bridge::QualityOption>,
    pub audio_quality: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppEvent {
    /// 会话状态整体推送：相位、模式、曲目、码率一起给。
    ///
    /// 进度事件每秒只带位置，界面上「在放还是暂停」「看还是听」
    /// 这类判断拿不到新值，就会停在旧快照上。状态一变就推一次完整的。
    State {
        snapshot: PlayerSnapshot,
    },
    Progress {
        position_ms: u64,
        duration_ms: u64,
        /// 0..1 的响度，界面拿它驱动频谱柱。
        level: f32,
        /// 这个位置是什么时候采的（引擎启动以来的毫秒数）。
        ///
        /// 事件经 IPC 到达前端会有延迟，主线程一卡就是几十上百毫秒；
        /// 前端拿这个值就能把「已经过去的时间」补回去，歌词不会滞后于声音。
        sent_at_ms: u64,
    },
    NowPlaying {
        track: Track,
        index: Option<usize>,
    },
    Buffering {
        track: Track,
    },
    Stopped,
    AuthChanged {
        auth: AuthSnapshot,
    },
    Notice {
        error: WireError,
        op: String,
    },
    Download {
        view: serde_json::Value,
    },
    LibraryChanged,
}
