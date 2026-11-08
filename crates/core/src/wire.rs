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
    pub repeat: String,
    pub shuffle: bool,
    pub quality_kbps: Option<u16>,
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthSnapshot {
    pub logged_in: bool,
    pub user: Option<AuthUser>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppEvent {
    Progress {
        position_ms: u64,
        duration_ms: u64,
        /// 0..1 的响度，界面拿它驱动频谱柱。
        level: f32,
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
