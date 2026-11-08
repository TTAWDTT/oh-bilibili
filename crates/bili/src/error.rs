//! 错误分类。五类，与 `docs/ARCHITECTURE.md` 第六节一一对应。

use std::time::Duration;

#[derive(Debug, Clone, thiserror::Error)]
pub enum BiliError {
    #[error("网络请求失败：{0}")]
    Network(String),

    /// 风控返回了 HTML 拦截页而不是 JSON。这是最需要人看见的一种失败。
    #[error("被风控拦截：HTTP {status}，响应前 120 字节：{head}")]
    Blocked { status: u16, head: String },

    #[error("接口返回错误 {code}：{message}")]
    Api { code: i64, message: String },

    #[error("触发限速或风控冷却，{retry_after:?} 后重试：{message}")]
    RateLimited {
        retry_after: Duration,
        message: String,
    },

    #[error("需要登录：{0}")]
    NeedsLogin(String),

    #[error("响应解析失败：{0}")]
    Parse(String),
}

