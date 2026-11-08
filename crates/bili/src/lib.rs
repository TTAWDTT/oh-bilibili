//! B 站接口适配层。
//!
//! 出门只有领域类型：`Track`、`TrackDetail`、`AudioStream`。
//! 这个 crate 之外的代码不会看到 bvid、cid、dash、fnval 这些词。

pub mod auth;
pub mod client;
pub mod media;
pub mod sync;
pub mod error;
pub mod search;
pub mod wbi;

use bilimusic_model::{Millis, Quality, SearchQuery, Track, TrackKey};

use crate::client::Client;
use crate::error::BiliError;
use crate::search::Candidate;

/// 搜索间隔。B 站对搜索最敏感，1 秒一次是保守值。
const SEARCH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(1000);
/// 取流间隔。
const PLAY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(300);

#[derive(Debug, Clone)]
pub struct TrackDetail {
    pub track: Track,
    pub cid: u64,
    pub aid: u64,
}

#[derive(Debug, Clone)]
pub struct AudioStream {
    pub quality: Quality,
    pub url: String,
    pub bandwidth: u64,
}

pub struct Source {
    client: Client,
}

impl Source {
    pub async fn open() -> Result<Source, BiliError> {
        let client = Client::new()?;
        client.ensure_fingerprint().await?;
        let _ = client.refresh_nav().await?;
        Ok(Source { client })
    }

    pub fn is_logged_in(&self) -> bool {
        self.client.is_logged_in()
    }

    pub fn nav(&self) -> client::NavState {
        self.client.nav_snapshot()
    }

    pub async fn refresh_session(&self) -> Result<client::NavState, BiliError> {
        self.client.refresh_nav().await
    }

    /// 搜索并排序。返回的 Track 里已经不含任何 B 站标识。
    pub async fn search(&self, query: &SearchQuery) -> Result<Vec<Track>, BiliError> {
        let value = self
            .client
            .signed_get(
                &format!("{}/x/web-interface/wbi/search/type", client::API),
                vec![
                    ("search_type", "video".to_string()),
                    ("keyword", query.keyword().to_string()),
                    ("page", query.page().to_string()),
                    ("page_size", "30".to_string()),
                ],
                SEARCH_INTERVAL,
            )
            .await?;

        let candidates = wire::search_candidates(&value)?;
        let ranked = search::rank(query.keyword(), candidates);
        Ok(ranked.iter().map(search::to_track).collect())
    }

    /// 用 TrackKey 换回 cid 与 aid。TrackKey 只在这个 crate 里被解释。
    pub async fn detail(&self, key: &TrackKey) -> Result<TrackDetail, BiliError> {
        let bvid = key.as_opaque().to_string();
        let value = self
            .client
            .signed_get(
                &format!("{}/x/web-interface/wbi/view", client::API),
                vec![("bvid", bvid.clone())],
                PLAY_INTERVAL,
            )
            .await?;
        wire::track_detail(&value, key)
    }

    /// 取流。返回的 URL 带签名会过期，不要长期缓存。
    pub async fn streams(&self, detail: &TrackDetail) -> Result<Vec<AudioStream>, BiliError> {
        let value = self
            .client
            .signed_get(
                &format!("{}/x/player/wbi/playurl", client::API),
                vec![
                    ("bvid", detail.track.key.as_opaque().to_string()),
                    ("cid", detail.cid.to_string()),
                    ("fnval", "16".to_string()),
                    ("fourk", "1".to_string()),
                    ("platform", "pc".to_string()),
                ],
                PLAY_INTERVAL,
            )
            .await?;
        wire::audio_streams(&value)
    }

    pub async fn login_qr(&self) -> Result<auth::QrChallenge, BiliError> {
        self.client.qrcode_generate().await
    }

    pub async fn poll_qr(&self, key: &str) -> Result<auth::QrStatus, BiliError> {
        let status = self.client.qrcode_poll(key).await?;
        if status == auth::QrStatus::Confirmed {
            let _ = self.client.refresh_nav().await?;
        }
        Ok(status)
    }

    pub async fn logout(&self) {
        self.client.clear_cookies();
    }

    /// 喜欢：登录后用 aid 点赞；游客直接拒绝。
    pub async fn set_like(&self, key: &TrackKey, on: bool) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        self.client.like_video(detail.aid, on).await
    }

    /// 收藏：落到固定名字的收藏夹，没有就建。
    pub async fn set_favorite(&self, key: &TrackKey, on: bool) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        let folder = self
            .client
            .ensure_fav_folder(sync::DEFAULT_FOLDER)
            .await?;
        self.client.set_favorite(detail.aid, folder, on).await
    }

    /// 给音频层用的请求头。`audio` 不认识 B 站，只认识这些键值。
    pub fn stream_headers(&self) -> Vec<(String, String)> {
        let cookie = self.client.cookie_header();
        let mut headers = vec![
            ("User-Agent".to_string(), client::UA.to_string()),
            ("Referer".to_string(), client::REFERER.to_string()),
        ];
        if !cookie.is_empty() {
            headers.push(("Cookie".to_string(), cookie));
        }
        headers
    }
}

mod wire {
    use super::*;

    fn as_u32(value: &serde_json::Value) -> u32 {
        value
            .as_u64()
            .map(|v| v as u32)
            .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
            .unwrap_or(0)
    }

    /// "5:17" 或 "1:02:03" 换成秒。
    fn parse_duration(raw: &str) -> Option<u64> {
        let parts: Vec<&str> = raw.split(':').collect();
        match parts.as_slice() {
            [m, s] => {
                let m: u64 = m.parse().ok()?;
                let s: u64 = s.parse().ok()?;
                Some(m * 60 + s)
            }
            [h, m, s] => {
                let h: u64 = h.parse().ok()?;
                let m: u64 = m.parse().ok()?;
                let s: u64 = s.parse().ok()?;
                Some(h * 3600 + m * 60 + s)
            }
            _ => None,
        }
    }

    fn norm_cover(pic: &str) -> Option<String> {
        if pic.is_empty() {
            return None;
        }
        if pic.starts_with("//") {
            Some(format!("https:{pic}"))
        } else if pic.starts_with("http") {
            Some(pic.to_string())
        } else {
            None
        }
    }

    pub fn search_candidates(value: &serde_json::Value) -> Result<Vec<Candidate>, BiliError> {
        let result = value["data"]["result"]
            .as_array()
            .ok_or_else(|| BiliError::Parse("搜索响应里没有 result 数组".into()))?;

        let mut out = Vec::with_capacity(result.len());
        for item in result {
            let Some(bvid) = item["bvid"].as_str() else {
                continue;
            };
            if bvid.is_empty() {
                continue;
            }
            let duration = item["duration"]
                .as_str()
                .and_then(parse_duration)
                .map(|s| Millis(s * 1000));
            out.push(Candidate {
                bvid: bvid.to_string(),
                title: search::strip_tags(item["title"].as_str().unwrap_or("（无标题）")),
                artist: item["author"].as_str().unwrap_or("").to_string(),
                cover: norm_cover(item["pic"].as_str().unwrap_or("")),
                duration,
                play: item["play"].as_u64().unwrap_or(0),
                typeid: as_u32(&item["typeid"]),
                score: 0.0,
            });
        }
        Ok(out)
    }

    pub fn track_detail(
        value: &serde_json::Value,
        key: &TrackKey,
    ) -> Result<TrackDetail, BiliError> {
        let data = &value["data"];
        let cid = data["cid"]
            .as_u64()
            .ok_or_else(|| BiliError::Parse("view 响应缺少 cid".into()))?;
        let aid = data["aid"].as_u64().unwrap_or(0);
        let track = Track {
            key: key.clone(),
            title: search::strip_tags(data["title"].as_str().unwrap_or("（无标题）")),
            artist: data["owner"]["name"].as_str().unwrap_or("").to_string(),
            duration: data["duration"].as_u64().map(|s| Millis(s * 1000)),
            cover: norm_cover(data["pic"].as_str().unwrap_or("")),
            accent: None,
        };
        Ok(TrackDetail { track, cid, aid })
    }

    pub fn audio_streams(value: &serde_json::Value) -> Result<Vec<AudioStream>, BiliError> {
        let audio = value["data"]["dash"]["audio"]
            .as_array()
            .ok_or_else(|| BiliError::Parse("playurl 响应里没有 dash.audio".into()))?;

        let mut out: Vec<AudioStream> = audio
            .iter()
            .filter_map(|a| {
                let id = a["id"].as_u64()? as u32;
                let quality = Quality::from_bili_id(id)?;
                let url = a["baseUrl"]
                    .as_str()
                    .or_else(|| a["base_url"].as_str())?
                    .to_string();
                Some(AudioStream {
                    quality,
                    url,
                    bandwidth: a["bandwidth"].as_u64().unwrap_or(0),
                })
            })
            .collect();

        out.sort_by(|a, b| b.quality.cmp(&a.quality));
        if out.is_empty() {
            return Err(BiliError::Parse("没有可用的音轨档位".into()));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 无音轨时报错而不是返回空() {
        let v = serde_json::json!({ "data": { "dash": { "audio": [] } } });
        assert!(wire::audio_streams(&v).is_err());
    }

    #[test]
    fn 未知清晰度被忽略() {
        let v = serde_json::json!({
            "data": { "dash": { "audio": [
                { "id": 30280, "baseUrl": "https://a/1.m4s", "bandwidth": 300000 },
                { "id": 99999, "baseUrl": "https://a/2.m4s", "bandwidth": 999 },
            ] } }
        });
        let streams = wire::audio_streams(&v).expect("应该有一档可用");
        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0].quality, Quality::K192);
    }

    #[test]
    fn 搜索候选剥标签并补全协议() {
        let v = serde_json::json!({
            "data": { "result": [{
                "bvid": "BV1xx411c7mD",
                "title": "周杰伦 - <em class=\"keyword\">晴天</em>",
                "author": "音乐无限",
                "pic": "//i0.hdslb.com/x.jpg",
                "duration": "5:17",
                "play": 12345,
                "typeid": "3"
            }] }
        });
        let c = wire::search_candidates(&v).expect("应该能解析");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].duration, Some(Millis(317_000)));
        assert_eq!(c[0].cover.as_deref(), Some("https://i0.hdslb.com/x.jpg"));
        assert_eq!(c[0].typeid, 3);
    }
}
