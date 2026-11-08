//! HTTP 客户端：cookie 罐、指纹引导、wbi 密钥缓存、限速闸门、风控冷却。
//!
//! 这些策略全部藏在 `bili` 内部，调用方只需要一个意图级方法。

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::error::BiliError;
use crate::wbi::WbiKeys;

pub const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub const API: &str = "https://api.bilibili.com";
pub const PASSPORT: &str = "https://passport.bilibili.com";
pub const REFERER: &str = "https://www.bilibili.com/";

/// 密钥缓存的寿命。nav 的 key 每天换一次，取 30 分钟足够稳也不浪费请求。
const KEY_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Default)]
pub struct NavState {
    pub is_login: bool,
    pub mid: Option<u64>,
    pub uname: Option<String>,
    pub avatar: Option<String>,
}

pub struct Client {
    http: reqwest::Client,
    jar: RwLock<HashMap<String, String>>,
    keys: tokio::sync::Mutex<Option<(WbiKeys, Instant)>>,
    gate: tokio::sync::Mutex<Option<Instant>>,
    cooldown: tokio::sync::Mutex<Option<Instant>>,
    nav: RwLock<NavState>,
}

impl Client {
    pub fn new() -> Result<Client, BiliError> {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| BiliError::Network(e.to_string()))?;
        Ok(Client {
            http,
            jar: RwLock::new(HashMap::new()),
            keys: tokio::sync::Mutex::new(None),
            gate: tokio::sync::Mutex::new(None),
            cooldown: tokio::sync::Mutex::new(None),
            nav: RwLock::new(NavState::default()),
        })
    }

    pub fn is_logged_in(&self) -> bool {
        self.nav.read().map(|n| n.is_login).unwrap_or(false)
    }

    pub fn nav_snapshot(&self) -> NavState {
        self.nav.read().map(|n| n.clone()).unwrap_or_default()
    }

    pub fn cookie_header(&self) -> String {
        let jar = self.jar.read().expect("cookie 罐被毒化");
        let mut pairs: Vec<String> = jar.iter().map(|(k, v)| format!("{k}={v}")).collect();
        pairs.sort();
        pairs.join("; ")
    }

    pub fn set_cookie(&self, name: &str, value: &str) {
        if let Ok(mut jar) = self.jar.write() {
            jar.insert(name.to_string(), value.to_string());
        }
    }

    pub fn cookie_value(&self, name: &str) -> Option<String> {
        self.jar.read().ok()?.get(name).cloned()
    }

    /// 导出 cookie，交给上层落盘。
    pub fn export_cookies(&self) -> Vec<(String, String)> {
        self.jar
            .read()
            .map(|jar| jar.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default()
    }

    /// 导入上次落盘的 cookie。登录态靠这个跨重启保留。
    pub fn import_cookies(&self, pairs: &[(String, String)]) {
        if let Ok(mut jar) = self.jar.write() {
            for (k, v) in pairs {
                jar.insert(k.clone(), v.clone());
            }
        }
    }

    pub fn clear_cookies(&self) {
        if let Ok(mut jar) = self.jar.write() {
            jar.clear();
        }
        if let Ok(mut nav) = self.nav.write() {
            *nav = NavState::default();
        }
    }

    /// 首次使用前必须调用：拿设备指纹，否则搜索会被风控挡成 HTML。
    pub async fn ensure_fingerprint(&self) -> Result<(), BiliError> {
        if self.cookie_value("buvid3").is_some() {
            return Ok(());
        }
        let v = self
            .get_json(&format!("{API}/x/frontend/finger/spi"), Duration::ZERO)
            .await?;
        if let Some(b3) = v["data"]["b_3"].as_str() {
            self.set_cookie("buvid3", b3);
        }
        if let Some(b4) = v["data"]["b_4"].as_str() {
            self.set_cookie("buvid4", b4);
        }
        Ok(())
    }

    /// 拉 nav，刷新登录态与 wbi 密钥。
    pub async fn refresh_nav(&self) -> Result<NavState, BiliError> {
        // nav 在未登录时返回 code=-101，但 data 里仍然有 wbi 密钥，所以这里放行。
        let v = self
            .get_json_allowing_guest(
                &format!("{API}/x/web-interface/nav"),
                Duration::from_millis(200),
            )
            .await
            .unwrap_or(Value::Null);
        let data = &v["data"];
        let nav = NavState {
            is_login: data["isLogin"].as_bool().unwrap_or(false),
            mid: data["mid"].as_u64().filter(|m| *m > 0),
            uname: data["uname"].as_str().map(|s| s.to_string()),
            avatar: data["face"].as_str().map(|s| s.replacen("http://", "https://", 1)),
        };
        if let Ok(mut guard) = self.nav.write() {
            *guard = nav.clone();
        }
        if let Some(keys) = WbiKeys::from_image_urls(
            data["wbi_img"]["img_url"].as_str().unwrap_or_default(),
            data["wbi_img"]["sub_url"].as_str().unwrap_or_default(),
        ) {
            *self.keys.lock().await = Some((keys, Instant::now()));
        }
        Ok(nav)
    }

    async fn wbi_keys(&self) -> Result<WbiKeys, BiliError> {
        {
            let guard = self.keys.lock().await;
            if let Some((keys, at)) = guard.as_ref() {
                if at.elapsed() < KEY_TTL {
                    return Ok(keys.clone());
                }
            }
        }
        self.refresh_nav().await?;
        let guard = self.keys.lock().await;
        guard
            .as_ref()
            .map(|(k, _)| k.clone())
            .ok_or_else(|| BiliError::Api {
                code: -1,
                message: "拿不到 wbi 密钥".into(),
            })
    }

    /// 全局串行闸门。B 站对并发很敏感，这里宁可慢。
    async fn gate(&self, min_interval: Duration) {
        if min_interval.is_zero() {
            return;
        }
        let mut last = self.gate.lock().await;
        if let Some(at) = *last {
            let elapsed = at.elapsed();
            if elapsed < min_interval {
                tokio::time::sleep(min_interval - elapsed).await;
            }
        }
        *last = Some(Instant::now());
    }

    async fn wait_cooldown(&self) -> Result<(), BiliError> {
        let guard = self.cooldown.lock().await;
        if let Some(until) = *guard {
            let now = Instant::now();
            if until > now {
                return Err(BiliError::RateLimited {
                    retry_after: until - now,
                    message: "上一次请求触发了风控，冷却中".into(),
                });
            }
        }
        Ok(())
    }

    pub async fn get_json(&self, url: &str, min_interval: Duration) -> Result<Value, BiliError> {
        self.get_json_inner(url, min_interval, false).await
    }

    /// 允许未登录响应的版本。只有 nav 这种「游客也能拿到有用数据」的接口该用它。
    pub async fn get_json_allowing_guest(
        &self,
        url: &str,
        min_interval: Duration,
    ) -> Result<Value, BiliError> {
        self.get_json_inner(url, min_interval, true).await
    }

    async fn get_json_inner(
        &self,
        url: &str,
        min_interval: Duration,
        allow_guest: bool,
    ) -> Result<Value, BiliError> {
        self.wait_cooldown().await?;
        self.gate(min_interval).await;

        let cookie = self.cookie_header();
        let mut req = self
            .http
            .get(url)
            .header("Referer", REFERER)
            .header("Origin", "https://www.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9");
        if !cookie.is_empty() {
            req = req.header("Cookie", cookie);
        }

        let resp = req.send().await.map_err(|e| BiliError::Network(e.to_string()))?;
        let status = resp.status();
        self.absorb_cookies(resp.headers());
        let body = resp
            .text()
            .await
            .map_err(|e| BiliError::Network(e.to_string()))?;

        self.classify(status.as_u16(), &body, allow_guest).await
    }

    async fn classify(
        &self,
        status: u16,
        body: &str,
        allow_guest: bool,
    ) -> Result<Value, BiliError> {
        // 风控时返回的是 HTML 拦截页，不是 JSON。这一条要单独识别。
        let value: Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => {
                let head: String = body.chars().take(120).collect();
                if status == 412 {
                    self.set_cooldown(Duration::from_secs(60)).await;
                }
                return Err(BiliError::Blocked { status, head });
            }
        };

        match value["code"].as_i64().unwrap_or(0) {
            0 => Ok(value),
            -101 if allow_guest => Ok(value),
            -101 => Err(BiliError::NeedsLogin(
                value["message"].as_str().unwrap_or("未登录").into(),
            )),
            -352 | -412 => {
                self.set_cooldown(Duration::from_secs(60)).await;
                Err(BiliError::RateLimited {
                    retry_after: Duration::from_secs(60),
                    message: value["message"].as_str().unwrap_or("风控").into(),
                })
            }
            other => Err(BiliError::Api {
                code: other,
                message: value["message"].as_str().unwrap_or("未知错误").into(),
            }),
        }
    }

    /// 把响应里的 Set-Cookie 收进罐里。登录靠的就是这一步。
    fn absorb_cookies(&self, headers: &reqwest::header::HeaderMap) {
        let mut jar = match self.jar.write() {
            Ok(j) => j,
            Err(_) => return,
        };
        for raw in headers.get_all("set-cookie").iter() {
            let Ok(text) = raw.to_str() else { continue };
            let pair = text.split(';').next().unwrap_or_default();
            let Some((name, value)) = pair.split_once('=') else {
                continue;
            };
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            jar.insert(name.to_string(), value.trim().to_string());
        }
    }

    /// 表单 POST。点赞、收藏、建收藏夹都走这里，所以也要过闸门。
    pub async fn post_form(
        &self,
        url: &str,
        form: Vec<(&str, String)>,
    ) -> Result<Value, BiliError> {
        self.wait_cooldown().await?;
        self.gate(Duration::from_millis(400)).await;

        let cookie = self.cookie_header();
        let mut req = self
            .http
            .post(url)
            .header("Referer", REFERER)
            .header("Origin", "https://www.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
            .form(&form);
        if !cookie.is_empty() {
            req = req.header("Cookie", cookie);
        }
        let resp = req.send().await.map_err(|e| BiliError::Network(e.to_string()))?;
        let status = resp.status();
        self.absorb_cookies(resp.headers());
        let body = resp
            .text()
            .await
            .map_err(|e| BiliError::Network(e.to_string()))?;
        self.classify(status.as_u16(), &body, false).await
    }

    /// 签名版 GET：先拿密钥，再拼查询串。
    pub async fn signed_get(
        &self,
        base: &str,
        params: Vec<(&str, String)>,
        min_interval: Duration,
    ) -> Result<Value, BiliError> {
        let keys = self.wbi_keys().await?;
        let wts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let query = keys.sign(&params, wts);
        self.get_json(&format!("{base}?{query}"), min_interval).await
    }

    async fn set_cooldown(&self, dur: Duration) {
        let mut guard = self.cooldown.lock().await;
        *guard = Some(Instant::now() + dur);
    }
}
