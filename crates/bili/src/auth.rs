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
    /// 直接可用的 SVG 字符串。二维码里是登录令牌，只能在本地生成，不能走第三方服务。
    pub svg: String,
}

/// 把文本渲染成二维码 SVG。用一个 path 合并所有深色模块，避免上万个 rect。
pub fn qr_svg(text: &str) -> Result<String, BiliError> {
    use qrcode::QrCode;
    let code = QrCode::new(text.as_bytes())
        .map_err(|e| BiliError::Parse(format!("二维码生成失败：{e}")))?;
    let width = code.width();
    let colors = code.to_colors();
    let mut path = String::new();
    for (i, c) in colors.iter().enumerate() {
        if *c == qrcode::Color::Dark {
            let x = i % width;
            let y = i / width;
            path.push_str(&format!("M{x} {y}h1v1h-1z"));
        }
    }
    Ok(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="168" height="168" viewBox="0 0 {width} {width}" shape-rendering="crispEdges"><rect width="{width}" height="{width}" fill="#ffffff"/><path d="{path}" fill="#000000"/></svg>"##
    ))
}

fn challenge_from_response(value: &serde_json::Value) -> Result<QrChallenge, BiliError> {
    let key = value["data"]["qrcode_key"]
        .as_str()
        .ok_or_else(|| BiliError::Parse("没有 qrcode_key".into()))?
        .to_string();
    let url = value["data"]["url"]
        .as_str()
        .ok_or_else(|| BiliError::Parse("没有二维码内容".into()))?
        .to_string();
    let svg = qr_svg(&url)?;
    Ok(QrChallenge { key, url, svg })
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
        challenge_from_response(&v)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 二维码是合法_svg_且带深色模块() {
        let svg = qr_svg("https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=abc123")
            .expect("应该能生成");
        assert!(svg.starts_with("<svg"), "必须是 svg");
        assert!(svg.contains("viewBox"), "必须有 viewBox 才能缩放");
        let modules = svg.matches("M").count();
        assert!(modules > 100, "深色模块太少，二维码会是空的：{modules}");
        assert!(svg.ends_with("</svg>"));
    }

    #[test]
    fn 不同内容生成不同图形() {
        let a = qr_svg("https://example.com/a").unwrap();
        let b = qr_svg("https://example.com/b").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn 固定响应能解析出二维码挑战() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "qrcode_key": "fixed-key",
                "url": "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=fixed-key"
            }
        });
        let qr = challenge_from_response(&value).expect("固定响应应该能解析");
        assert_eq!(qr.key, "fixed-key");
        assert!(qr.url.starts_with("https://passport.bilibili.com/"));
        assert!(qr.svg.starts_with("<svg"), "必须生成本地 SVG");
        assert!(
            qr.svg.matches("M").count() > 100,
            "深色模块太少，二维码会是空的"
        );
    }

    #[test]
    fn 缺少二维码字段时明确报解析错误() {
        let value = serde_json::json!({ "data": { "qrcode_key": "fixed-key" } });
        match challenge_from_response(&value) {
            Err(BiliError::Parse(message)) => {
                assert!(message.contains("二维码内容"), "错误应说明缺了什么：{message}");
            }
            other => panic!("预期解析错误，实际 {other:?}"),
        }
    }
}
