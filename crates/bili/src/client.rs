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
/// 直播走独立域名，房间数据不在主 API 下。
pub const LIVE_API: &str = "https://api.live.bilibili.com";
pub const PASSPORT: &str = "https://passport.bilibili.com";
pub const REFERER: &str = "https://www.bilibili.com/";

/// 密钥缓存的寿命。nav 的 key 每天换一次，取 30 分钟足够稳也不浪费请求。
const KEY_TTL: Duration = Duration::from_secs(30 * 60);

fn session_origin(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url
            .domain()
            .is_some_and(|host| host == "bilibili.com" || host.ends_with(".bilibili.com"))
}

#[derive(Debug, Clone, Default)]
pub struct NavState {
    pub is_login: bool,
    pub mid: Option<u64>,
    pub uname: Option<String>,
    pub avatar: Option<String>,
    pub level: u8,
    pub coins: f64,
}

pub struct Client {
    http: reqwest::Client,
    jar: RwLock<HashMap<String, String>>,
    keys: tokio::sync::Mutex<Option<(WbiKeys, Instant)>>,
    gate: tokio::sync::Mutex<Option<Instant>>,
    /// 播放专用的闸门，与通用闸门分开。
    ///
    /// 通用闸门是全局串行的：换歌时 detail/playurl 要排在弹幕、相关推荐、
    /// UP 名片后面，实测能等到一两秒。播放是用户按下去就要有反应的动作，
    /// 所以给它一条独立队列。
    play_gate: tokio::sync::Mutex<Option<Instant>>,
    /// 关系接口单独一条闸门：设置页打开时不能排在推荐预取后面。
    relation_gate: tokio::sync::Mutex<Option<Instant>>,
    cooldown: tokio::sync::Mutex<Option<Instant>>,
    nav: RwLock<NavState>,
    /// 罐里的 cookie 自上次落盘后是否变过。
    ///
    /// B 站会通过 Set-Cookie 轮换 SESSDATA；只存在内存里不写盘的话，
    /// 重启后加载的是登录当天的旧 cookie，一旦被轮换就会被判未登录。
    cookies_dirty: std::sync::atomic::AtomicBool,
}

impl Client {
    pub fn new() -> Result<Client, BiliError> {
        let redirects = reqwest::redirect::Policy::default();
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().last().is_some_and(session_origin)
                    && attempt.url().scheme() != "https"
                {
                    return attempt.stop();
                }
                redirects.redirect(attempt)
            }))
            .build()
            .map_err(|e| BiliError::Network(e.to_string()))?;
        Ok(Client {
            http,
            jar: RwLock::new(HashMap::new()),
            keys: tokio::sync::Mutex::new(None),
            gate: tokio::sync::Mutex::new(None),
            play_gate: tokio::sync::Mutex::new(None),
            relation_gate: tokio::sync::Mutex::new(None),
            cooldown: tokio::sync::Mutex::new(None),
            nav: RwLock::new(NavState::default()),
            cookies_dirty: std::sync::atomic::AtomicBool::new(false),
        })
    }

    pub fn is_logged_in(&self) -> bool {
        self.nav.read().map(|n| n.is_login).unwrap_or(false)
    }

    pub fn nav_snapshot(&self) -> NavState {
        self.nav.read().map(|n| n.clone()).unwrap_or_default()
    }

    fn cookie_header(&self) -> String {
        let jar = self.jar.read().expect("cookie 罐被毒化");
        let mut pairs: Vec<String> = jar.iter().map(|(k, v)| format!("{k}={v}")).collect();
        pairs.sort();
        pairs.join("; ")
    }

    fn session_request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        let request = self.http.request(method, url);
        if reqwest::Url::parse(url).is_ok_and(|url| session_origin(&url)) {
            let cookie = self.cookie_header();
            if !cookie.is_empty() {
                return request.header(reqwest::header::COOKIE, cookie);
            }
        }
        request
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
            // 只清登录态。buvid3/buvid4/b_nut 是设备指纹，属于这台机器而不是账号，
            // 退出登录后保留它们——否则本会话内所有需要指纹的接口都会变成 -412。
            let keep = ["buvid3", "buvid4", "b_nut", "buvid_fp"];
            jar.retain(|k, _| keep.contains(&k.as_str()));
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
            level: data["level_info"]["current_level"].as_u64().unwrap_or(0) as u8,
            coins: data["money"].as_f64().unwrap_or(0.0),
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
        let gate = &self.gate;
        Client::wait_slot(gate, min_interval).await;
    }

    /// 播放链路用这条：不和后台请求抢。
    pub async fn gate_play(&self, min_interval: Duration) {
        let gate = &self.play_gate;
        Client::wait_slot(gate, min_interval).await;
    }

    async fn wait_slot(gate: &tokio::sync::Mutex<Option<Instant>>, min_interval: Duration) {
        if min_interval.is_zero() {
            return;
        }
        let mut last = gate.lock().await;
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
        self.get_json_inner(url, min_interval, false, false, false).await
    }

    /// 关系接口：独立闸门，避免被列表预取挡住。
    pub async fn get_json_relation(
        &self,
        url: &str,
        min_interval: Duration,
    ) -> Result<Value, BiliError> {
        self.get_json_inner(url, min_interval, false, true, false).await
    }

    /// 允许未登录响应的版本。只有 nav 这种「游客也能拿到有用数据」的接口该用它。
    pub async fn get_json_allowing_guest(
        &self,
        url: &str,
        min_interval: Duration,
    ) -> Result<Value, BiliError> {
        self.get_json_inner(url, min_interval, true, false, false).await
    }

    async fn get_json_inner(
        &self,
        url: &str,
        min_interval: Duration,
        allow_guest: bool,
        relation: bool,
        ignore_cooldown: bool,
    ) -> Result<Value, BiliError> {
        // 冷却只压普通接口。播放链路是主路径：评论区被限流不该顺手把视频也停了，
        // 真被风控拦下时 classify 仍会重新记一次冷却。
        if !ignore_cooldown {
            self.wait_cooldown().await?;
        }
        if relation {
            Client::wait_slot(&self.relation_gate, min_interval).await;
        } else {
            self.gate(min_interval).await;
        }

        let req = self
            .session_request(reqwest::Method::GET, url)
            .header("Referer", REFERER)
            .header("Origin", "https://www.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9");
        let resp = req.send().await.map_err(|e| BiliError::Network(e.to_string()))?;
        let status = resp.status();
        if session_origin(resp.url()) {
            self.absorb_cookies(resp.headers());
        }
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

    /// 取原始字节。弹幕接口给的是压缩流，需要调用方自己解。
    pub async fn get_bytes(&self, url: &str, min_interval: Duration) -> Result<Vec<u8>, BiliError> {
        self.wait_cooldown().await?;
        self.gate(min_interval).await;
        let req = self
            .session_request(reqwest::Method::GET, url)
            .header("Referer", REFERER)
            .header("User-Agent", UA);
        let resp = req.send().await.map_err(|e| BiliError::Network(e.to_string()))?;
        Ok(resp.bytes().await.map_err(|e| BiliError::Network(e.to_string()))?.to_vec())
    }

    /// 取原始文本。弹幕接口返回的是 XML，不是 JSON。
    pub async fn get_text(&self, url: &str, min_interval: Duration) -> Result<String, BiliError> {
        self.wait_cooldown().await?;
        self.gate(min_interval).await;
        let req = self
            .session_request(reqwest::Method::GET, url)
            .header("Referer", REFERER)
            .header("User-Agent", UA);
        let resp = req.send().await.map_err(|e| BiliError::Network(e.to_string()))?;
        resp.text().await.map_err(|e| BiliError::Network(e.to_string()))
    }

    /// 把响应里的 Set-Cookie 收进罐里。登录靠的就是这一步。
    fn absorb_cookies(&self, headers: &reqwest::header::HeaderMap) {
        let mut dropped = false;
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
            let new_value = value.trim().to_string();
            if jar.get(name) != Some(&new_value) {
                jar.insert(name.to_string(), new_value);
                dropped = true;
            }
        }
        drop(jar);
        if dropped {
            self.cookies_dirty
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    /// 记一条 cookie，值真的变了才置脏。供 absorb_cookies 与测试共用。
    fn remember(&self, name: &str, value: &str) -> bool {
        let mut jar = self.jar.write().expect("cookie 罐");
        if jar.get(name) == Some(&value.to_string()) {
            return false;
        }
        jar.insert(name.to_string(), value.to_string());
        self.cookies_dirty
            .store(true, std::sync::atomic::Ordering::Relaxed);
        true
    }

    /// 取走「变脏」标记：返回 true 就说明该落盘了。
    pub fn take_cookies_dirty(&self) -> bool {
        self.cookies_dirty
            .swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    /// 表单 POST。点赞、收藏、建收藏夹都走这里，所以也要过闸门。
    pub async fn post_form(
        &self,
        url: &str,
        form: Vec<(&str, String)>,
    ) -> Result<Value, BiliError> {
        self.wait_cooldown().await?;
        self.gate(Duration::from_millis(400)).await;

        let req = self
            .session_request(reqwest::Method::POST, url)
            .header("Referer", REFERER)
            .header("Origin", "https://www.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
            .form(&form);
        let resp = req.send().await.map_err(|e| BiliError::Network(e.to_string()))?;
        let status = resp.status();
        if session_origin(resp.url()) {
            self.absorb_cookies(resp.headers());
        }
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

    /// 同上，但走播放专用闸门：换歌不该排在弹幕和相关推荐后面。
    pub async fn signed_get_play(
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
        self.gate_play(min_interval).await;
        // 闸门已经过完了，这里用零间隔再走一遍完整流程（含 cookie 吸收），
        // 但不吃别的接口留下的冷却。
        self.get_json_inner(&format!("{base}?{query}"), Duration::ZERO, false, false, true)
            .await
    }

    async fn set_cooldown(&self, dur: Duration) {
        let mut guard = self.cooldown.lock().await;
        *guard = Some(Instant::now() + dur);
    }
}

#[cfg(test)]
mod logout_tests {
    use super::Client;

    /// 退出登录只该清账号凭据，设备指纹要留着。
    #[test]
    fn 退出登录保留设备指纹() {
        let client = Client::new().expect("client");
        client.import_cookies(&[
            ("buvid3".into(), "DEVICE-3".into()),
            ("buvid4".into(), "DEVICE-4".into()),
            ("b_nut".into(), "1700000000".into()),
            ("SESSDATA".into(), "session".into()),
            ("bili_jct".into(), "csrf".into()),
            ("DedeUserID".into(), "123".into()),
        ]);
        client.clear_cookies();

        assert_eq!(client.cookie_value("buvid3").as_deref(), Some("DEVICE-3"));
        assert_eq!(client.cookie_value("buvid4").as_deref(), Some("DEVICE-4"));
        assert_eq!(client.cookie_value("b_nut").as_deref(), Some("1700000000"));
        assert!(client.cookie_value("SESSDATA").is_none(), "登录凭据必须清掉");
        assert!(client.cookie_value("bili_jct").is_none(), "csrf 必须清掉");
        assert!(client.cookie_value("DedeUserID").is_none());
    }
}

#[cfg(test)]
mod cookie_dirty_tests {
    use super::Client;

    /// 服务端轮换 cookie 时必须标脏，否则只在内存里更新、重启就回到旧值。
    #[test]
    fn 值变化才标脏() {
        let client = Client::new().expect("client");
        client.import_cookies(&[("SESSDATA".into(), "old".into())]);
        // 清掉 import 可能留下的影响，从干净状态开始
        let _ = client.take_cookies_dirty();
        assert!(!client.take_cookies_dirty(), "干净状态不该是脏的");

        // 同一个值重复下发不算变化
        client.remember("SESSDATA", "old");
        assert!(!client.take_cookies_dirty(), "值没变不该标脏");

        client.remember("SESSDATA", "new");
        assert!(client.take_cookies_dirty(), "值变了要标脏");
        assert!(!client.take_cookies_dirty(), "取走之后要复位");
    }
}

#[cfg(test)]
mod cookie_scope_tests {
    use super::Client;

    #[test]
    fn 只给安全的站内接口附带登录凭据() {
        let client = Client::new().unwrap();
        client.import_cookies(&[("SESSDATA".into(), "synthetic".into())]);
        for (url, expected) in [
            ("https://api.bilibili.com/", true),
            ("https://api.live.bilibili.com/", true),
            ("https://www.bilibili.com/", true),
            ("http://api.bilibili.com/", false),
            ("https://api.bilibili.com:8443/", false),
            ("https://aisubtitle.hdslb.com/", false),
            ("https://api.bilibili.com.example.invalid/", false),
            ("https://api.bilibili.com@example.invalid/", false),
        ] {
            let request = client
                .session_request(reqwest::Method::GET, url)
                .build()
                .unwrap();
            assert_eq!(
                request.headers().contains_key(reqwest::header::COOKIE),
                expected,
                "{url}"
            );
        }
    }
}
