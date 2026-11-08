//! 二维码登录。
//!
//! 流程三步：拿二维码 -> 轮询状态 -> 成功后从 Set-Cookie 里取 SESSDATA 与 bili_jct。
//! 这两个 cookie 是后续点赞、收藏、高码率取流的凭据。

use crate::client::{Client, PASSPORT};
use crate::error::BiliError;

#[derive(Debug, Clone)]
pub struct QrChallenge {
    pub key: String,
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QrStatus {
    Waiting,
    Scanned,
    Confirmed,
    Expired,
}

impl Client {
    pub async fn qrcode_generate(&self) -> Result<QrChallenge, BiliError> {
        let v = self
            .get_json(
                &format!("{PASSPORT}/x/passport-login/web/qrcode/generate"),
                std::time::Duration::from_millis(300),
            )
            .await?;
        let key = v["data"]["qrcode_key"]
            .as_str()
            .ok_or_else(|| BiliError::Parse("没有 qrcode_key".into()))?
            .to_string();
        let url = v["data"]["url"]
            .as_str()
            .ok_or_else(|| BiliError::Parse("没有二维码内容".into()))?
            .to_string();
        Ok(QrChallenge { key, url })
    }

    /// 轮询。`Confirmed` 时 cookie 已经落进罐里，调用方接着刷 nav。
    pub async fn qrcode_poll(&self, key: &str) -> Result<QrStatus, BiliError> {
        let url = format!("{PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key={key}");
        let v = self
            .get_json(&url, std::time::Duration::from_millis(300))
            .await?;
        let code = v["data"]["code"].as_i64().unwrap_or(-1);
        let status = match code {
            0 => QrStatus::Confirmed,
            86101 => QrStatus::Waiting,
            86090 => QrStatus::Scanned,
            86038 => QrStatus::Expired,
            _ => QrStatus::Waiting,
        };
        Ok(status)
    }

    pub fn logged_in_mid(&self) -> Option<u64> {
        self.nav_snapshot().mid
    }

    pub fn csrf(&self) -> Option<String> {
        self.cookie_value("bili_jct")
    }
}
