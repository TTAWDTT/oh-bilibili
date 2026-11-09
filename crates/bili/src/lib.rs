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

/// 视频详情。B 站视频页右侧那栏的信息，我们只取不需要额外请求就能拿到的部分。
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct VideoMeta {
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

#[derive(Debug, Clone)]
pub struct TrackDetail {
    pub track: Track,
    pub cid: u64,
    pub aid: u64,
    pub meta: VideoMeta,
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
        self.search_ordered(query, bilimusic_model::SearchOrder::TotalRank)
            .await
    }

    /// 带排序的搜索。B 站的 order 参数：click 最多播放、pubdate 最新发布、dm 最多弹幕。
    pub async fn search_ordered(
        &self,
        query: &SearchQuery,
        order: bilimusic_model::SearchOrder,
    ) -> Result<Vec<Track>, BiliError> {
        self.search_in_partition(query, order, None).await
    }

    /// 带分区搜索。
    ///
    /// `tid` 是 B 站的一级分区 id（音乐 3、动画 1、游戏 4…），交给接口的 `tids` 参数，
    /// 它会返回该分区下所有子分区的结果。实测有效——之前以为 `tids` 失效，
    /// 实际是撞上限流返回空列表。
    pub async fn search_in_partition(
        &self,
        query: &SearchQuery,
        order: bilimusic_model::SearchOrder,
        tid: Option<u32>,
    ) -> Result<Vec<Track>, BiliError> {
        let mut params = vec![
            ("search_type", "video".to_string()),
            ("keyword", query.keyword().to_string()),
            ("page", query.page().to_string()),
            ("page_size", "30".to_string()),
        ];
        if let Some(tid) = tid {
            params.push(("tids", tid.to_string()));
        }
        if let Some(order_param) = order.as_param() {
            params.push(("order", order_param.to_string()));
        }
        let value = self
            .client
            .signed_get(
                &format!("{}/x/web-interface/wbi/search/type", client::API),
                params,
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

    /// 收藏夹列表。
    pub async fn fav_folders(&self) -> Result<Vec<(i64, String, u32)>, BiliError> {
        self.client.fav_folders().await
    }

    /// 收藏夹内容，转成 Track。
    pub async fn fav_tracks(&self, folder_id: i64) -> Result<Vec<Track>, BiliError> {
        let keys = self.client.fav_items(folder_id).await?;
        let mut out = Vec::new();
        for bvid in keys {
            let key = TrackKey::from_provider(bvid);
            if let Ok(detail) = self.detail(&key).await {
                out.push(detail.track);
            }
        }
        Ok(out)
    }

    /// 这条视频是否已在稍后再看里。
    pub async fn in_watch_later(&self, key: &TrackKey) -> Result<bool, BiliError> {
        let detail = self.detail(key).await?;
        Ok(self.client.watch_later().await?.contains(&detail.aid))
    }

    /// 加入或移出稍后再看。
    pub async fn set_watch_later(&self, key: &TrackKey, on: bool) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        if on {
            self.client.watch_later_add(detail.aid).await
        } else {
            self.client.watch_later_remove(detail.aid).await
        }
    }

    /// 关注 UP 主。
    pub async fn set_follow(&self, mid: u64, on: bool) -> Result<(), BiliError> {
        self.client.follow(mid, on).await
    }

    /// 投币。三连里的「币」，和点赞是同一次操作的两个动作。
    pub async fn add_coin(&self, key: &TrackKey, count: u8, also_like: bool) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        self.client.add_coin(detail.aid, count, also_like).await
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

    /// B 站字幕。作为歌词的第三级来源：视频没挂字幕就返回空。
    pub async fn subtitles(&self, key: &TrackKey) -> Result<Vec<(u64, String)>, BiliError> {
        let detail = self.detail(key).await?;
        let value = self
            .client
            .signed_get(
                &format!("{}/x/player/wbi/v2", client::API),
                vec![
                    ("bvid", key.as_opaque().to_string()),
                    ("cid", detail.cid.to_string()),
                ],
                PLAY_INTERVAL,
            )
            .await?;

        let Some(list) = value["data"]["subtitle"]["subtitles"].as_array() else {
            return Ok(Vec::new());
        };
        let Some(url) = list
            .iter()
            .filter_map(|s| s["subtitle_url"].as_str())
            .find(|u| !u.is_empty())
        else {
            return Ok(Vec::new());
        };
        let absolute = if url.starts_with("//") {
            format!("https:{url}")
        } else {
            url.to_string()
        };
        let body = self
            .client
            .get_json(&absolute, std::time::Duration::from_millis(200))
            .await?;
        Ok(wire::subtitle_lines(&body))
    }

    /// 取一条音视频合一的 MP4 地址，给界面里的 `<video>` 用。
    ///
    /// 用 fnval=1 拿 durl，而不是 DASH：MASH 的音轨与视频轨是分开的，
    /// 要自己同步；durl 是单个 mp4，浏览器原生播放器能直接处理。
    pub async fn mv_url(&self, key: &TrackKey) -> Result<String, BiliError> {
        let bvid = key.as_opaque().to_string();
        let detail = self.detail(key).await?;
        let value = self
            .client
            .signed_get(
                &format!("{}/x/player/wbi/playurl", client::API),
                vec![
                    ("bvid", bvid),
                    ("cid", detail.cid.to_string()),
                    ("fnval", "1".to_string()),
                    ("platform", "pc".to_string()),
                ],
                PLAY_INTERVAL,
            )
            .await?;
        value["data"]["durl"][0]["url"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| BiliError::Parse("这条视频没有可播放的 mp4".into()))
    }

    pub fn export_cookies(&self) -> Vec<(String, String)> {
        self.client.export_cookies()
    }

    pub fn import_cookies(&self, pairs: &[(String, String)]) {
        self.client.import_cookies(pairs);
    }

    /// 拉这条视频的真实弹幕，带时间戳。
    ///
    /// `<d p="秒,模式,字号,颜色,时间戳,...">文本</d>`，第一个字段是出现时间。
    pub async fn danmaku_colored(
        &self,
        key: &TrackKey,
    ) -> Result<Vec<(f64, String, u32)>, BiliError> {
        let detail = self.detail(key).await?;
        let items = self.danmaku_by_cid(detail.cid).await?;
        Ok(items)
    }

    /// 兼容旧调用：只要文本。
    async fn danmaku_texts(&self, key: &TrackKey) -> Result<Vec<(f64, String)>, BiliError> {
        Ok(self
            .danmaku_colored(key)
            .await?
            .into_iter()
            .map(|(t, s, _)| (t, s))
            .collect())
    }

    pub async fn danmaku_items(&self, key: &TrackKey) -> Result<Vec<(f64, String)>, BiliError> {
        self.danmaku_texts(key).await
    }

    async fn danmaku_by_cid(&self, cid: u64) -> Result<Vec<(f64, String, u32)>, BiliError> {
        let url = format!(
            "https://api.bilibili.com/x/v1/dm/list.so?oid={cid}"
        );
        let raw = self
            .client
            .get_bytes(&url, std::time::Duration::from_millis(300))
            .await?;
        // B 站弹幕接口返回 deflate 压缩的 XML，不先解压拿到的是二进制。
        let mut body = String::new();
        {
            use std::io::Read;
            let mut decoder = flate2::read::DeflateDecoder::new(raw.as_slice());
            if decoder.read_to_string(&mut body).is_err() {
                body = String::from_utf8_lossy(&raw).to_string();
            }
        }

        let mut out = Vec::new();
        for chunk in body.split("<d ").skip(1) {
            let Some((attrs, rest)) = chunk.split_once('>') else {
                continue;
            };
            let text = rest.split("</d>").next().unwrap_or("").trim();
            if text.is_empty() || text.chars().count() > 40 {
                continue;
            }
            let Some(p) = attrs.split('"').nth(1) else { continue };
            let fields: Vec<&str> = p.split(',').collect();
            let secs = fields.first().and_then(|t| t.parse::<f64>().ok()).unwrap_or(0.0);
            // 第 4 个字段是十进制 RGB，B 站默认白色 16777215。
            let color = fields
                .get(3)
                .and_then(|t| t.parse::<u32>().ok())
                .unwrap_or(0xFFFFFF);
            out.push((secs, text.to_string(), color));
        }
        Ok(out)
    }

    /// 拉这条视频的真实弹幕文本，够滚动用。
    pub async fn danmaku(&self, key: &TrackKey) -> Result<Vec<String>, BiliError> {
        let items = self.danmaku_items(key).await?;
        Ok(items.into_iter().map(|(_, t)| t).take(60).collect())
    }

    /// 高能进度：把弹幕按时间分桶，得到一条密度曲线。
    ///
    /// B 站播放器进度条上那些亮色段就是这么来的——弹幕越密的地方越亮。
    pub async fn danmaku_heat(
        &self,
        key: &TrackKey,
        buckets: usize,
    ) -> Result<Vec<u32>, BiliError> {
        let items = self.danmaku_items(key).await?;
        let buckets = buckets.clamp(8, 200);
        let mut heat = vec![0u32; buckets];
        if items.is_empty() {
            return Ok(heat);
        }
        let max_t = items
            .iter()
            .map(|(t, _)| *t)
            .fold(0.0_f64, f64::max)
            .max(1.0);
        for (t, _) in &items {
            let idx = ((t / max_t) * (buckets as f64 - 1.0)).round() as usize;
            if let Some(slot) = heat.get_mut(idx.min(buckets - 1)) {
                *slot += 1;
            }
        }
        Ok(heat)
    }

    /// 相关推荐。B 站播放页底部那排，用的是同一条推荐接口。
    pub async fn related(&self, key: &TrackKey) -> Result<Vec<Track>, BiliError> {
        let value = self
            .client
            .get_json(
                &format!(
                    "{}/x/web-interface/archive/related?bvid={}",
                    client::API,
                    key.as_opaque()
                ),
                PLAY_INTERVAL,
            )
            .await?;

        let Some(list) = value["data"].as_array() else {
            return Ok(Vec::new());
        };
        let mut out = Vec::with_capacity(list.len());
        for item in list {
            let Some(bvid) = item["bvid"].as_str() else {
                continue;
            };
            let typeid = item["typeid"].as_u64().unwrap_or(0) as u32;
            out.push(Track {
                key: TrackKey::from_provider(bvid),
                title: search::strip_tags(item["title"].as_str().unwrap_or("（无标题）")),
                artist: item["owner"]["name"].as_str().unwrap_or("").to_string(),
                duration: item["duration"].as_u64().map(Millis),
                cover: wire::norm_cover(item["pic"].as_str().unwrap_or("")),
                accent: None,
                views: item["stat"]["view"].as_u64(),
                danmaku: item["stat"]["danmaku"].as_u64(),
                up_avatar: item["owner"]["face"]
                    .as_str()
                    .map(|f| f.replacen("http://", "https://", 1)),
                up_mid: item["owner"]["mid"].as_u64(),
                tname: search::partition_name(typeid).map(|n| n.to_string()),
                typeid: Some(typeid),
            });
        }
        Ok(out)
    }

    /// 当前 cookie 串，代理转发视频时要带上。
    pub fn cookie_header(&self) -> String {
        self.client.cookie_header()
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

    pub fn norm_cover(pic: &str) -> Option<String> {
        if pic.is_empty() {
            return None;
        }
        if pic.starts_with("//") {
            Some(format!("https:{pic}"))
        } else if let Some(rest) = pic.strip_prefix("http://") {
            // 接口有时给 http 图床，webview 里会被判混合内容，统一升到 https。
            Some(format!("https://{rest}"))
        } else if pic.starts_with("https://") {
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
                views: item["play"].as_u64().unwrap_or(0),
                danmaku: item["video_review"].as_u64().unwrap_or(0),
                up_avatar: norm_cover(item["upic"].as_str().unwrap_or("")),
                up_mid: item["mid"].as_u64(),
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
        let stat = &data["stat"];
        let meta = VideoMeta {
            desc: data["desc"].as_str().unwrap_or("").trim().to_string(),
            pubdate: data["pubdate"].as_i64().unwrap_or(0),
            views: stat["view"].as_u64().unwrap_or(0),
            danmaku: stat["danmaku"].as_u64().unwrap_or(0),
            replies: stat["reply"].as_u64().unwrap_or(0),
            favorites: stat["favorite"].as_u64().unwrap_or(0),
            coins: stat["coin"].as_u64().unwrap_or(0),
            shares: stat["share"].as_u64().unwrap_or(0),
            likes: stat["like"].as_u64().unwrap_or(0),
        };
        let track = Track {
            key: key.clone(),
            title: search::strip_tags(data["title"].as_str().unwrap_or("（无标题）")),
            artist: data["owner"]["name"].as_str().unwrap_or("").to_string(),
            duration: data["duration"].as_u64().map(|s| Millis(s * 1000)),
            cover: norm_cover(data["pic"].as_str().unwrap_or("")),
            accent: None,
            views: data["stat"]["view"].as_u64(),
            danmaku: data["stat"]["danmaku"].as_u64(),
            up_avatar: data["owner"]["face"]
                .as_str()
                .map(|f| f.replacen("http://", "https://", 1)),
            up_mid: data["owner"]["mid"].as_u64(),
            tname: data["tname"].as_str().map(|s| s.to_string()),
            typeid: data["tid"].as_u64().map(|v| v as u32),
        };
        Ok(TrackDetail {
            track,
            cid,
            aid,
            meta,
        })
    }

    /// 字幕 JSON 的 body 是 `[{from: 秒, content: "..."}]`。
    pub fn subtitle_lines(value: &serde_json::Value) -> Vec<(u64, String)> {
        value["body"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let from = item["from"].as_f64()?;
                        let content = item["content"].as_str()?.trim().to_string();
                        if content.is_empty() {
                            return None;
                        }
                        Some(((from.max(0.0) * 1000.0).round() as u64, content))
                    })
                    .collect()
            })
            .unwrap_or_default()
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
    fn 字幕_json_解析成时间轴() {
        let v = serde_json::json!({
            "body": [
                { "from": 1.5, "content": "第一句" },
                { "from": 3.0, "content": "  第二句  " },
                { "from": 4.0, "content": "   " }
            ]
        });
        let lines = wire::subtitle_lines(&v);
        assert_eq!(lines.len(), 2, "空白行要丢掉");
        assert_eq!(lines[0], (1500, "第一句".to_string()));
        assert_eq!(lines[1].1, "第二句");
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

#[cfg(test)]
mod auth_tests {
    use super::*;

    /// 没有登录态时，点赞与收藏必须在发请求之前就被挡住。
    /// 这条不依赖网络，可以离线跑。
    #[tokio::test]
    async fn 未登录时点赞直接报需要登录() {
        let source = Source::open().await.expect("Source 能开");
        source.logout().await;
        let key = TrackKey::from_provider("BV1d4411N7zD");
        match source.set_like(&key, true).await {
            Err(BiliError::NeedsLogin(_)) => {}
            other => panic!("预期 NeedsLogin，实际 {other:?}"),
        }
    }

    #[tokio::test]
    async fn 未登录时收藏同样被挡() {
        let source = Source::open().await.expect("Source 能开");
        source.logout().await;
        let key = TrackKey::from_provider("BV1d4411N7zD");
        match source.set_favorite(&key, true).await {
            Err(BiliError::NeedsLogin(_)) => {}
            other => panic!("预期 NeedsLogin，实际 {other:?}"),
        }
    }

    #[tokio::test]
    async fn 二维码挑战有可渲染内容() {
        let source = Source::open().await.expect("Source 能开");
        let qr = source.login_qr().await.expect("二维码应该能生成");
        assert!(!qr.key.is_empty(), "qrcode_key 不能为空");
        assert!(qr.url.starts_with("http"), "二维码内容应该是一个链接");
    }
}
