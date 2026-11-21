//! B 站接口适配层。
//!
//! 出门只有领域类型：`Track`、`TrackDetail`、`AudioStream`。
//! 这个 crate 之外的代码不会看到 bvid、cid、dash、fnval 这些词。

pub mod comments;
pub mod feed;
pub mod dash;
pub mod auth;
pub mod client;
pub mod media;
pub mod messages;
pub mod sync;
pub mod error;
pub mod search;
pub mod wbi;

use bilimusic_model::{Millis, Quality, SearchQuery, Track, TrackKey};
use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::error::BiliError;
use crate::search::Candidate;

/// 搜索间隔。
///
/// B 站的搜索限流是按窗口算请求数，不是按间隔：实测 350ms 连翻 30 页照样条条有货，
/// 一分钟内超过三十几页才开始回空。压间隔不增加总预算，只是让同样的页数更早到手——
/// 缓冲要在十秒内铺满，不然用户已经划到底了还在等下一页。
const SEARCH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(400);
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

/// 搜索页热搜榜的一条。`keyword` 是真正拿去搜的词，`label` 是榜单上的展示名。
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HotSearchItem {
    pub keyword: String,
    pub label: String,
    /// 榜单自带的角标图，可能为空。
    pub icon: String,
    pub heat: u64,
}

#[derive(Debug, Clone)]
pub struct TrackDetail {
    pub track: Track,
    pub cid: u64,
    pub aid: u64,
    pub meta: VideoMeta,
    /// 分P 列表。单 P 视频就是一条。
    pub pages: Vec<PageRef>,
    /// 这条视频所属的合集。B 站观看页右栏那一块「合集」。
    pub season: Option<SeasonRef>,
}

/// 一个合集。只有 `ugc_season` 存在的视频才有。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeasonRef {
    pub id: u64,
    pub title: String,
    /// 合集里的每一集，顺序就是 B 站的播放顺序。
    pub episodes: Vec<SeasonEpisode>,
}

/// 合集里的一集。字段足够直接渲染成一列可点的条目。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeasonEpisode {
    pub bvid: String,
    pub title: String,
    pub cover: Option<String>,
    pub duration_ms: u64,
    pub views: Option<u64>,
}

/// 一条弹幕。`mode` 是 B 站的位置：1 滚动、4 底部、5 顶部。
///
/// 以前只留了时间/文本/颜色，顶部和底部弹幕就都被当成滚动弹幕横向飞了。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DanmakuLine {
    pub secs: f64,
    pub text: String,
    pub color: u32,
    pub mode: u32,
}

/// 一个分P。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageRef {
    /// 从 1 开始的序号。
    pub no: u32,
    pub cid: u64,
    pub title: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct AudioStream {
    pub quality: Quality,
    pub url: String,
    pub bandwidth: u64,
}

pub struct Source {
    client: Client,
    /// 视频详情缓存（cid/aid 不会变）。
    ///
    /// 换歌时 detail 要花 150ms 外加一次限速等待，而同一首歌重复播很常见。
    /// 只存最近若干条，避免长时间使用后无限增长。
    detail_cache: std::sync::Mutex<std::collections::HashMap<String, TrackDetail>>,
}

/// 详情缓存最多留这么多条。
const DETAIL_CACHE_MAX: usize = 128;

/// 弹幕正文是 XML 文本，`<` `>` `&` 都以实体出现。
///
/// 不解码的话，弹幕里的 `>ᗜ<` 会原样显示成 `&gt;ᗜ&lt;`。
fn xml_unescape(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        // `&amp;` 放最后：`&amp;lt;` 这类转义过的字面量不该被二次解开。
        .replace("&amp;", "&")
}

impl Source {
    pub async fn open() -> Result<Source, BiliError> {
        let client = Client::new()?;
        client.ensure_fingerprint().await?;
        let _ = client.refresh_nav().await?;
        Ok(Source {
            client,
            detail_cache: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }

    /// cookie 是否在上次落盘后有变化。
    pub fn take_cookies_dirty(&self) -> bool {
        self.client.take_cookies_dirty()
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
        self.search_scoped(query, order, tid, None).await
    }

    /// 带分区与时长的搜索。
    ///
    /// `duration`：1 = 10 分钟以下，2 = 10~30 分钟，3 = 30~60 分钟，4 = 60 分钟以上。
    pub async fn search_scoped(
        &self,
        query: &SearchQuery,
        order: bilimusic_model::SearchOrder,
        tid: Option<u32>,
        duration: Option<u32>,
    ) -> Result<Vec<Track>, BiliError> {
        let mut params = vec![
            ("search_type", "video".to_string()),
            ("keyword", query.keyword().to_string()),
            ("page", query.page().to_string()),
            // 接口上限就是 50（实测 50 条全带封面）。一次取满，
            // 列表深预取时少跑几轮往返。
            ("page_size", "50".to_string()),
        ];
        if let Some(tid) = tid {
            params.push(("tids", tid.to_string()));
        }
        if let Some(d) = duration.filter(|d| (1..=4).contains(d)) {
            params.push(("duration", d.to_string()));
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
        // 只有当用户没指定排序（综合）时才按标题匹配重排；
        // 选了「最多播放/最新发布/最多弹幕」就尊重 B 站给的顺序。
        let ordered = match order {
            bilimusic_model::SearchOrder::TotalRank => search::rank(query.keyword(), candidates),
            _ => search::dedupe(candidates),
        };
        Ok(ordered.iter().map(search::to_track).collect())
    }

    /// 用 TrackKey 换回 cid 与 aid。TrackKey 只在这个 crate 里被解释。
    pub async fn detail(&self, key: &TrackKey) -> Result<TrackDetail, BiliError> {
        let bvid = key.as_opaque().to_string();
        if let Ok(cache) = self.detail_cache.lock() {
            if let Some(hit) = cache.get(&bvid) {
                return Ok(hit.clone());
            }
        }
        let value = self
            .client
            .signed_get_play(
                &format!("{}/x/web-interface/wbi/view", client::API),
                vec![("bvid", bvid.clone())],
                PLAY_INTERVAL,
            )
            .await?;
        let detail = wire::track_detail(&value, key)?;
        if let Ok(mut cache) = self.detail_cache.lock() {
            if cache.len() >= DETAIL_CACHE_MAX {
                // 简单清一半，够用且不用引入 LRU 依赖
                let keep: Vec<String> = cache.keys().take(DETAIL_CACHE_MAX / 2).cloned().collect();
                for k in keep {
                    cache.remove(&k);
                }
            }
            cache.insert(bvid, detail.clone());
        }
        Ok(detail)
    }

    /// 取流。返回的 URL 带签名会过期，不要长期缓存。
    pub async fn streams(&self, detail: &TrackDetail) -> Result<Vec<AudioStream>, BiliError> {
        let value = self
            .client
            .signed_get_play(
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

    /// 一条视频在当前账号里的点赞/收藏/投币状态。
    pub async fn relation_state(&self, key: &TrackKey) -> Result<(bool, bool, u32), BiliError> {
        // 用 bvid 就够，不必先取 detail——省一次请求
        self.client.relation_state(&key.as_opaque()).await
    }

    /// UP 主投稿。
    pub async fn space_videos(
        &self,
        mid: u64,
        page: u32,
        order: &str,
    ) -> Result<(Vec<Track>, u32), BiliError> {
        self.client.space_videos(mid, page, order).await
    }

    /// UP 主粉丝与关注数。
    pub async fn space_stat(&self, mid: u64) -> Result<(u64, u64), BiliError> {
        self.client.space_stat(mid).await
    }

    /// 我关注的人。
    pub async fn following(&self, page: u32) -> Result<(Vec<sync::Followed>, u32), BiliError> {
        self.client.following(page).await
    }

    /// 关注动态。
    pub async fn dynamic_feed(
        &self,
        offset: Option<String>,
    ) -> Result<sync::DynamicPage, BiliError> {
        self.client.dynamic_feed(offset).await
    }

    pub async fn message_unread(&self) -> Result<messages::MessageUnread, BiliError> {
        self.client.message_unread().await
    }

    pub async fn messages(
        &self,
        kind: messages::MessageKind,
        cursor: Option<String>,
        page: u32,
    ) -> Result<messages::MessagePage, BiliError> {
        self.client.messages(kind, cursor, page).await
    }

    /// 稍后再看列表。
    pub async fn watch_later_list(&self) -> Result<Vec<Track>, BiliError> {
        self.client.watch_later_tracks().await
    }

    /// 上报观看进度。未登录时返回 Err，调用方忽略即可。
    pub async fn report_progress(
        &self,
        key: &TrackKey,
        played_secs: u64,
        start_ts: u64,
    ) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        self.client
            .report_progress(detail.aid, detail.cid, played_secs, start_ts)
            .await
    }

    /// UP 主名片（粉丝数、签名、认证）。
    pub async fn author_card(&self, mid: u64) -> Result<crate::sync::AuthorCard, BiliError> {
        self.client.author_card(mid).await
    }

    /// 收藏夹列表。
    pub async fn fav_folders(&self) -> Result<Vec<sync::FavFolder>, BiliError> {
        self.client.fav_folders().await
    }

    /// 收藏夹列表页的四宫格封面。
    pub async fn fav_covers(&self, folder_id: i64, limit: u32) -> Result<Vec<String>, BiliError> {
        self.client.fav_covers(folder_id, limit).await
    }

    /// 我赞过的视频。
    pub async fn liked_videos(&self) -> Result<Vec<Track>, BiliError> {
        self.client.liked_videos().await
    }

    /// 视频标签。
    pub async fn video_tags(&self, bvid: &str) -> Result<Vec<String>, BiliError> {
        self.client.video_tags(bvid).await
    }

    /// 评论表情面板。
    pub async fn comment_emotes(&self) -> Result<Vec<(String, String)>, BiliError> {
        self.client.comment_emotes().await
    }

    /// 搜 UP 主。
    pub async fn search_users(
        &self,
        keyword: &str,
        page: u32,
    ) -> Result<Vec<sync::UserHit>, BiliError> {
        self.client.search_users(keyword, page).await
    }

    /// 排行榜。
    pub async fn ranking(&self, rid: u32) -> Result<Vec<Track>, BiliError> {
        self.client.ranking(rid).await
    }

    /// 正在直播的房间。
    pub async fn live_rooms(&self, count: u32, page: u32) -> Result<Vec<sync::LiveRoom>, BiliError> {
        self.client.live_rooms(count, page).await
    }

    /// 番剧排行。
    pub async fn bangumi_rank(
        &self,
        count: usize,
        season_type: u32,
    ) -> Result<Vec<sync::BangumiItem>, BiliError> {
        self.client.bangumi_rank(count, season_type).await
    }

    /// 当前账号的追番。
    pub async fn followed_bangumi(&self, page: u32) -> Result<(Vec<sync::BangumiItem>, u32), BiliError> {
        self.client.followed_bangumi(page).await
    }

    /// 番剧更新表（周一…周日）。
    pub async fn bangumi_timeline(&self) -> Result<Vec<sync::BangumiDay>, BiliError> {
        self.client.bangumi_timeline().await
    }

    /// 综合热门。第二个返回值表示后面还有没有更早的稿件，第三个是按 bvid 对齐的小标签。
    pub async fn popular(
        &self,
        page: u32,
    ) -> Result<(Vec<Track>, bool, std::collections::HashMap<String, String>), BiliError> {
        self.client.popular(page).await
    }

    /// 每周必看：期数列表（公开接口，不需要 wbi）。
    pub async fn weekly_issues(&self) -> Result<Vec<sync::WeeklyIssue>, BiliError> {
        self.client.weekly_issues().await
    }

    /// 每周必看：某一期的片单。
    pub async fn weekly_issue(&self, number: u32) -> Result<sync::WeeklyIssuePage, BiliError> {
        self.client.weekly_issue(number).await
    }

    /// 单期原始响应，只给调试与探针用。
    pub async fn weekly_issue_raw(&self, number: u32) -> Result<serde_json::Value, BiliError> {
        self.client.weekly_issue_raw(number).await
    }

    /// 入站必刷：标题、官方文案与每条视频的推荐语。
    pub async fn precious(&self) -> Result<(String, String, Vec<sync::PreciousItem>), BiliError> {
        self.client.precious().await
    }

    /// 观看页的元信息：在看人数 + 可用的字幕轨（同一个响应，只请求一次）。
    pub async fn video_meta(&self, bvid: &str, cid: u64) -> Result<sync::VideoMeta, BiliError> {
        self.client.video_meta(bvid, cid).await
    }

    /// 这条视频的 AI 总结；没有总结的稿件返回 None。
    pub async fn video_summary(
        &self,
        bvid: &str,
        cid: u64,
        up_mid: u64,
    ) -> Result<Option<sync::VideoSummary>, BiliError> {
        self.client.video_summary(bvid, cid, up_mid).await
    }

    /// 取一条字幕轨的全部台词。`lan` 传 `None` 时优先中文。
    pub async fn subtitle_cues(
        &self,
        key: &TrackKey,
        cid: Option<u64>,
        lan: Option<&str>,
    ) -> Result<Vec<sync::SubtitleCue>, BiliError> {
        // 字幕挂在每一 P 上，`detail.cid` 是第一 P。不给 cid 时才退回它。
        let cid = match cid {
            Some(cid) => cid,
            None => self.detail(key).await?.cid,
        };
        let value = self
            .client
            .signed_get_play(
                &format!("{}/x/player/wbi/v2", client::API),
                vec![
                    ("bvid", key.as_opaque().to_string()),
                    ("cid", cid.to_string()),
                ],
                PLAY_INTERVAL,
            )
            .await?;
        let list = value["data"]["subtitle"]["subtitles"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let usable: Vec<&serde_json::Value> = list
            .iter()
            .filter(|s| s["subtitle_url"].as_str().is_some_and(|u| !u.is_empty()))
            .collect();
        // 没指定语言就先中文（ai-zh / zh-CN 都算），再退第一条。
        let picked = match lan {
            Some(want) => usable.iter().find(|s| s["lan"].as_str() == Some(want)),
            None => usable
                .iter()
                .find(|s| s["lan"].as_str().unwrap_or("").starts_with("zh"))
                .or_else(|| usable.first()),
        };
        let Some(track) = picked else {
            return Ok(Vec::new());
        };
        let url = track["subtitle_url"].as_str().unwrap_or("");
        let absolute = if let Some(rest) = url.strip_prefix("//") {
            format!("https:{rest}")
        } else {
            url.to_string()
        };
        // 正文在 CDN 上，是静态 JSON，不跟 B 站接口挤同一条串行闸门。
        let body = self
            .client
            .get_json(&absolute, std::time::Duration::ZERO)
            .await?;
        Ok(body["body"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let from = item["from"].as_f64()?.max(0.0);
                        let to = item["to"].as_f64().unwrap_or(from).max(from);
                        let text = item["content"].as_str()?.trim().to_string();
                        if text.is_empty() {
                            return None;
                        }
                        Some(sync::SubtitleCue {
                            at_ms: (from * 1000.0).round() as u64,
                            end_ms: (to * 1000.0).round() as u64,
                            text,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 进度条悬停预览的缩略图。
    pub async fn video_shots(&self, bvid: &str, cid: u64) -> Result<sync::VideoShots, BiliError> {
        self.client.video_shots(bvid, cid).await
    }

    /// 把一条视频从指定收藏夹移出。
    pub async fn unfav_from(&self, key: &TrackKey, folder: i64) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        self.client.set_favorite(detail.aid, folder, false).await
    }

    /// 收藏夹内容，转成 Track。
    pub async fn fav_tracks(&self, folder_id: i64, page: u32) -> Result<Vec<Track>, BiliError> {
        // 列表接口已经带齐字段，不再逐条查详情
        self.client.fav_tracks(folder_id, page).await
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

    /// 当前账号是否已关注这个 UP 主。
    pub async fn is_following(&self, mid: u64) -> Result<bool, BiliError> {
        self.client.is_following(mid).await
    }

    /// 批量查关注状态，顺序与入参一致。
    pub async fn relation_followed_many(
        &self,
        mids: &[u64],
    ) -> Result<Vec<(u64, bool)>, BiliError> {
        self.client.relation_followed_many(mids).await
    }

    /// 投币。三连里的「币」，和点赞是同一次操作的两个动作。
    pub async fn add_coin(&self, key: &TrackKey, count: u8, also_like: bool) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        self.client.add_coin(detail.aid, count, also_like).await
    }

    /// 收藏：落到固定名字的收藏夹，没有就建。
    /// 收藏。`folder` 为 None 时收进默认收藏夹「哔哩哔哩 music」。
    pub async fn set_favorite(
        &self,
        key: &TrackKey,
        on: bool,
        folder: Option<i64>,
    ) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        let folder = match folder {
            Some(id) => id,
            None => self.client.ensure_fav_folder(sync::DEFAULT_FOLDER).await?,
        };
        self.client.set_favorite(detail.aid, folder, on).await
    }

    /// 发一条弹幕。`progress_ms` 是它出现在视频里的时刻。
    pub async fn send_danmaku(
        &self,
        key: &TrackKey,
        cid: Option<u64>,
        text: &str,
        progress_ms: u64,
        mode: u64,
        color: u32,
    ) -> Result<(), BiliError> {
        // 多 P 视频的弹幕按 P 分池，`detail.cid` 是第一 P。不给 cid 时才退回它。
        let cid = match cid {
            Some(cid) => cid,
            None => self.detail(key).await?.cid,
        };
        self.client
            .send_danmaku(cid, &key.as_opaque(), text, progress_ms, mode, color)
            .await
    }

    /// B 站字幕。作为歌词的第三级来源：视频没挂字幕就返回空。
    pub async fn subtitles(&self, key: &TrackKey) -> Result<Vec<(u64, String)>, BiliError> {
        let detail = self.detail(key).await?;
        // 字幕属于播放链路（歌词要用），走播放专用闸门：
        // 通用闸门是全局串行的，会被弹幕、相关推荐这些后台请求堵住，
        // 实测歌词因此拖到 8.9 秒。
        let value = self
            .client
            .signed_get_play(
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
        // 字幕正文在 CDN 上（aisubtitle.hdslb.com），是静态 JSON，
        // 不该和 B 站接口挤同一条串行闸门——实测被挤到 6 秒。
        let body = self
            .client
            .get_json(&absolute, std::time::Duration::ZERO)
            .await?;
        Ok(wire::subtitle_lines(&body))
    }

    /// 取一屏推荐。风控随时可能拒绝，失败就返回空列表，界面显示「换一批」。
    pub async fn home_feed(&self, fresh: u32) -> Result<Vec<Track>, BiliError> {
        let value = self
            .client
            .signed_get(
                &format!("{}/x/web-interface/wbi/index/top/feed/rcmd", client::API),
                vec![
                    // 一次取 30 条（接口上限）：只取 12 条时界面补齐两屏要连发三次，
                    // 用户每次划过一屏都要等一轮网络往返。
                    ("ps", "30".to_string()),
                    ("fresh_type", "3".to_string()),
                    ("fresh_idx", fresh.to_string()),
                    ("feed_version", "V8".to_string()),
                ],
                std::time::Duration::from_millis(600),
            )
            .await?;
        Ok(crate::feed::items_from(&value))
    }

    /// 取一页评论。aid 来自详情，评论区只读，失败就返回空页。
    ///
    /// 走 `x/v2/reply/wbi/main`：游标翻页，参数和 B 站桌面端一致。老接口
    /// `x/v2/reply?pn=` 连翻几页就会被风控拦下。
    pub async fn comments(
        &self,
        key: &TrackKey,
        cursor: Option<&str>,
        hot: bool,
    ) -> Result<crate::comments::CommentPage, BiliError> {
        let detail = self.detail(key).await?;
        // 3 是「按热度」，2 是「按时间」，和桌面端 `mode` 一致。
        let mode = if hot { "3" } else { "2" };
        let offset = cursor.unwrap_or("");
        let value = self
            .client
            .signed_get(
                &format!("{}/x/v2/reply/wbi/main", client::API),
                vec![
                    ("type", "1".to_string()),
                    ("oid", detail.aid.to_string()),
                    ("mode", mode.to_string()),
                    (
                        "pagination_str",
                        format!("{{\"offset\":\"{offset}\"}}"),
                    ),
                    ("plat", "1".to_string()),
                    ("web_location", "1315875".to_string()),
                ],
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(crate::comments::cursor_page_from(&value, cursor.is_none()))
    }

    /// 取一页楼中楼。`root` 是一级评论的 rpid，`cursor` 是上一页的 `next`，
    /// 第一页传 None。
    ///
    /// 走 `x/v2/reply/detail`：B 站桌面端的楼中楼列表就是它，翻页靠 `pagination_str`
    /// 里的不透明游标。老的 `reply/reply?pn=` 是页码协议。官方的 `dialog/cursor`
    /// 只返回某一条二级评论的对话分支（`dialog` 传一级 rpid 会回空），拿它列整栋楼
    /// 并不对。
    pub async fn comment_replies(
        &self,
        key: &TrackKey,
        root: &str,
        cursor: Option<&str>,
    ) -> Result<crate::comments::CommentPage, BiliError> {
        let detail = self.detail(key).await?;
        let offset = cursor.unwrap_or("");
        let pagination = crate::wbi::encode_uri_component(
            &serde_json::json!({ "offset": offset }).to_string(),
        );
        let value = self
            .client
            .get_json(
                &format!(
                    "{}/x/v2/reply/detail?type=1&oid={}&root={}&pagination_str={}&plat=1",
                    client::API,
                    detail.aid,
                    root,
                    pagination
                ),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(crate::comments::detail_page_from(&value))
    }

    /// 取一页「查看对话」。`root` 是一级评论 rpid，`dialog` 是分支里某条
    /// 二级评论的 rpid；`cursor` 是上一页的 `next`，第一页传 None。
    ///
    /// 走官方 `x/v2/reply/dialog/cursor`：它按一条对话分支翻页，和楼中楼列表
    /// 的 `reply/detail` 是两件事。`dialog` 必须指向真实二级评论，传一级 rpid 回空。
    pub async fn comment_dialog(
        &self,
        key: &TrackKey,
        root: &str,
        dialog: &str,
        cursor: Option<&str>,
    ) -> Result<crate::comments::CommentPage, BiliError> {
        let detail = self.detail(key).await?;
        let offset = cursor.unwrap_or("");
        let pagination = crate::wbi::encode_uri_component(
            &serde_json::json!({ "offset": offset }).to_string(),
        );
        let value = self
            .client
            .get_json(
                &format!(
                    "{}/x/v2/reply/dialog/cursor?type=1&oid={}&root={}&dialog={}&size=20&pagination_str={}&plat=1",
                    client::API,
                    detail.aid,
                    root,
                    dialog,
                    pagination
                ),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(crate::comments::dialog_page_from(&value))
    }

    pub async fn search_suggest(&self, term: &str) -> Result<Vec<String>, BiliError> {
        self.client.search_suggest(term).await
    }

    /// 搜索页的热搜榜。B 站搜索页左栏就是这份榜单，带名次。
    ///
    /// 游客也能拿到，不需要登录；失败就返回空表，由界面退回内置建议。
    pub async fn hot_search(&self) -> Result<Vec<HotSearchItem>, BiliError> {
        let value = self
            .client
            .get_json_allowing_guest(
                &format!("{}/x/web-interface/search/square?limit=12", client::API),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let list = value["data"]["trending"]["list"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let raw_keyword = item["keyword"].as_str().unwrap_or("");
                        let raw_label = item["show_name"].as_str().unwrap_or("");
                        let keyword = if raw_keyword.is_empty() { raw_label } else { raw_keyword };
                        let label = if raw_label.is_empty() { raw_keyword } else { raw_label };
                        if keyword.is_empty() && label.is_empty() {
                            return None;
                        }
                        Some(HotSearchItem {
                            keyword: keyword.to_string(),
                            label: label.to_string(),
                            icon: item["icon"]
                                .as_str()
                                .unwrap_or("")
                                .replacen("http://", "https://", 1),
                            heat: item["heat_score"].as_u64().unwrap_or(0),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(list)
    }

    /// 发一条评论，或回复某一条。
    ///
    /// 回复时 `root` 是楼中楼的根评论，`parent` 是被回复的那条；不传就是一级评论。
    /// 两个 id 都是 `rpid_str`，B 站把它当字符串处理，转成数字会溢出。
    pub async fn comment_add(
        &self,
        key: &TrackKey,
        text: &str,
        root: Option<&str>,
        parent: Option<&str>,
    ) -> Result<String, BiliError> {
        let detail = self.detail(key).await?;
        let csrf = self
            .client
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        let mut body = vec![
            ("type", "1".to_string()),
            ("oid", detail.aid.to_string()),
            ("message", text.to_string()),
            ("plat", "1".to_string()),
            ("csrf", csrf),
        ];
        if let Some(root_id) = root {
            body.push(("root", root_id.to_string()));
            body.push(("parent", parent.unwrap_or(root_id).to_string()));
        }
        let value = self
            .client
            .post_form(&format!("{}/x/v2/reply/add", client::API), body)
            .await?;
        // 返回新评论的 rpid，界面拿它在列表里认出自己刚发的那条。
        Ok(value["data"]["rpid_str"]
            .as_str()
            .map(str::to_string)
            .or_else(|| value["data"]["rpid"].as_i64().map(|v| v.to_string()))
            .unwrap_or_default())
    }

    /// 删掉自己发的一条评论。别人的评论会被服务端拒绝。
    pub async fn comment_del(&self, key: &TrackKey, rpid: &str) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        let csrf = self
            .client
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        self.client
            .post_form(
                &format!("{}/x/v2/reply/del", client::API),
                vec![
                    ("type", "1".to_string()),
                    ("oid", detail.aid.to_string()),
                    ("rpid", rpid.to_string()),
                    ("csrf", csrf),
                ],
            )
            .await?;
        Ok(())
    }

    /// 给一条评论点赞或取消点赞。
    pub async fn comment_like(
        &self,
        key: &TrackKey,
        rpid: &str,
        like: bool,
    ) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        let csrf = self
            .client
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        self.client
            .post_form(
                &format!("{}/x/v2/reply/action", client::API),
                vec![
                    ("type", "1".to_string()),
                    ("oid", detail.aid.to_string()),
                    ("rpid", rpid.to_string()),
                    ("action", if like { "1" } else { "0" }.to_string()),
                    ("csrf", csrf),
                ],
            )
            .await?;
        Ok(())
    }

    /// 给一条评论点踩或取消点踩。
    ///
    /// 走官方桌面端同款 `x/v2/reply/hate`：`action=1` 点踩、`action=0` 取消。
    /// 点赞与点踩在服务端是同一个互斥状态，点赞会把点踩顶掉。
    pub async fn comment_hate(
        &self,
        key: &TrackKey,
        rpid: &str,
        hate: bool,
    ) -> Result<(), BiliError> {
        let detail = self.detail(key).await?;
        let csrf = self
            .client
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        self.client
            .post_form(
                &format!("{}/x/v2/reply/hate", client::API),
                vec![
                    ("type", "1".to_string()),
                    ("oid", detail.aid.to_string()),
                    ("rpid", rpid.to_string()),
                    ("action", if hate { "1" } else { "0" }.to_string()),
                    ("csrf", csrf),
                ],
            )
            .await?;
        Ok(())
    }

    /// 取 DASH 的视频轨。只返回视频，音频永远走音频引擎。
    ///
    /// 用 fnval=4048 拿到全部特性与全部档位（含 1080P+），并且 fourk=1
    /// 才允许 4K 档出现。fnval=1 的 durl 单文件只到 720P，够不到这里。
    pub async fn dash_video(&self, key: &TrackKey) -> Result<Vec<crate::dash::VideoStream>, BiliError> {
        self.dash_video_at(key, None).await
    }

    /// 取指定分P 的视频轨。`page_cid` 为空时用主 cid。
    pub async fn dash_video_at(
        &self,
        key: &TrackKey,
        page_cid: Option<u64>,
    ) -> Result<Vec<crate::dash::VideoStream>, BiliError> {
        let detail = self.detail(key).await?;
        let cid = page_cid.unwrap_or(detail.cid);
        let value = self
            .client
            .signed_get_play(
                &format!("{}/x/player/wbi/playurl", client::API),
                vec![
                    ("bvid", key.as_opaque().to_string()),
                    ("cid", cid.to_string()),
                    ("fnval", "4048".into()),
                    ("fourk", "1".into()),
                    // platform=pc 才会给全档位。少了它只回 480P 与 360P。
                    ("platform", "pc".into()),
                ],
                PLAY_INTERVAL,
            )
            .await?;
        let video = value["data"]["dash"]["video"]
            .as_array()
            .ok_or_else(|| BiliError::Api {
                code: -1,
                message: "这条内容没有 DASH 视频轨".into(),
            })?;
        serde_json::from_value(serde_json::Value::Array(video.clone())).map_err(|e| BiliError::Api {
            code: -1,
            message: format!("视频轨解析失败：{e}"),
        })
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
        cid: Option<u64>,
    ) -> Result<Vec<DanmakuLine>, BiliError> {
        let cid = match cid {
            Some(cid) => cid,
            None => self.detail(key).await?.cid,
        };
        let items = self.danmaku_by_cid(cid).await?;
        Ok(items)
    }

    /// 兼容旧调用：只要文本。
    async fn danmaku_texts(&self, key: &TrackKey) -> Result<Vec<(f64, String)>, BiliError> {
        Ok(self
            .danmaku_colored(key, None)
            .await?
            .into_iter()
            .map(|line| (line.secs, line.text))
            .collect())
    }

    pub async fn danmaku_items(&self, key: &TrackKey) -> Result<Vec<(f64, String)>, BiliError> {
        self.danmaku_texts(key).await
    }

    async fn danmaku_by_cid(&self, cid: u64) -> Result<Vec<DanmakuLine>, BiliError> {
        // x/v1/dm/list.so 现在返回一张 HTML 页，拿不到弹幕了（实测 3.4KB 的登录页）。
        // comment.bilibili.com 的 XML 还在，且一次给全量。
        let url = format!("https://comment.bilibili.com/{cid}.xml");
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
            let text = xml_unescape(rest.split("</d>").next().unwrap_or("").trim());
            if text.is_empty() || text.chars().count() > 40 {
                continue;
            }
            let Some(p) = attrs.split('"').nth(1) else { continue };
            let fields: Vec<&str> = p.split(',').collect();
            let secs = fields.first().and_then(|t| t.parse::<f64>().ok()).unwrap_or(0.0);
            // 第 4 个字段是十进制 RGB，B 站默认白色 16777215；
            // 第 2 个是位置：1 滚动、4 底部、5 顶部。
            let color = fields
                .get(3)
                .and_then(|t| t.parse::<u32>().ok())
                .unwrap_or(0xFFFFFF);
            let mode = fields
                .get(1)
                .and_then(|t| t.parse::<u32>().ok())
                .unwrap_or(1);
            out.push(DanmakuLine {
                secs,
                text,
                color,
                mode,
            });
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
                // 这条接口的 duration 是秒，别的地方（feed、详情）也都是秒，唯独这里之前漏了换算，
                // 结果相关推荐每一行的时长都渲染成 0:00。
                duration: item["duration"].as_u64().map(|s| Millis(s * 1000)),
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

    /// 播放地址已签名，CDN 请求只需 UA 和来源页。
    pub fn stream_headers(&self) -> Vec<(String, String)> {
        vec![
            ("User-Agent".to_string(), client::UA.to_string()),
            ("Referer".to_string(), client::REFERER.to_string()),
        ]
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

/// 从 view 响应里读合集。没有合集就是 None。
///
/// 每集的标题/封面/时长/播放量都在 `arc` 里；`arc` 偶尔缺失，那就只给
/// bvid 和标题，界面仍然能点进去。
fn season_of(data: &serde_json::Value) -> Option<SeasonRef> {
    let season = data.get("ugc_season")?;
    let id = season["id"].as_u64()?;
    let mut episodes = Vec::new();
    for section in season["sections"].as_array().into_iter().flatten() {
        for ep in section["episodes"].as_array().into_iter().flatten() {
            let Some(bvid) = ep["bvid"].as_str().filter(|s| !s.is_empty()) else {
                continue;
            };
            let arc = &ep["arc"];
            episodes.push(SeasonEpisode {
                bvid: bvid.to_string(),
                title: search::strip_tags(ep["title"].as_str().unwrap_or("（无标题）")),
                cover: norm_cover(arc["pic"].as_str().unwrap_or("")),
                duration_ms: arc["duration"].as_u64().unwrap_or(0) * 1000,
                views: arc["stat"]["view"].as_u64(),
            });
        }
    }
    if episodes.is_empty() {
        return None;
    }
    Some(SeasonRef {
        id,
        title: search::strip_tags(season["title"].as_str().unwrap_or("合集")),
        episodes,
    })
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
        let pages: Vec<PageRef> = data["pages"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|p| {
                        Some(PageRef {
                            no: p["page"].as_u64()? as u32,
                            cid: p["cid"].as_u64()?,
                            title: search::strip_tags(p["part"].as_str().unwrap_or("")),
                            duration_ms: p["duration"].as_u64().unwrap_or(0) * 1000,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
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
            // 有些投稿的 tname 是空串（分区被隐藏或已下线），
            // 保留成 Some("") 会让界面上多出一个空标签。
            tname: data["tname"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string()),
            typeid: data["tid"].as_u64().map(|v| v as u32),
        };
        Ok(TrackDetail {
            track,
            cid,
            aid,
            pages,
            meta,
            season: season_of(data),
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
            // 全部是未知 id（B 站以后加新档位时会这样）：退到第一档，不要直接失败。
            // 界面显示的码率会按实际带宽算，不会撒谎。
            let first = audio.first().ok_or_else(|| BiliError::Parse("没有可用音轨".into()))?;
            let url = first["baseUrl"]
                .as_str()
                .or_else(|| first["base_url"].as_str())
                .ok_or_else(|| BiliError::Parse("音轨没有 url".into()))?;
            // 按实测带宽推断档位，而不是硬写一个可能错的标签。
            let bandwidth = first["bandwidth"].as_u64().unwrap_or(0);
            let quality = match bandwidth {
                b if b >= 900_000 => Quality::HiRes,
                b if b >= 400_000 => Quality::Dolby,
                _ => Quality::K192,
            };
            return Ok(vec![AudioStream {
                quality,
                url: url.to_string(),
                bandwidth,
            }]);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 弹幕 XML 里的 `<` `>` `&` 是实体；真实数据里就有 `>ᗜ<` 这种颜文字。
    #[test]
    fn 弹幕里的实体要解开() {
        assert_eq!(xml_unescape("好肥啊˶&gt;ᗜ&lt;˶"), "好肥啊˶>ᗜ<˶");
        assert_eq!(xml_unescape("A &amp; B"), "A & B");
        // 已经被转义过一次的字面量不该被二次解开。
        assert_eq!(xml_unescape("&amp;lt;"), "&lt;");
        // 没有 & 的串原样返回，不复制。
        assert_eq!(xml_unescape("普通弹幕"), "普通弹幕");
    }

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
mod offline_guard_tests {
    use crate::client::Client;

    use super::*;

    /// 没有登录态时，写操作必须在发请求之前就被挡住。
    #[tokio::test]
    async fn 未登录时点赞在发请求前被拦截() {
        let client = Client::new().expect("client");
        match client.like_video(1, true).await {
            Err(BiliError::NeedsLogin(_)) => {}
            other => panic!("预期 NeedsLogin，实际 {other:?}"),
        }
    }

    #[tokio::test]
    async fn 未登录时收藏同样被拦截() {
        let client = Client::new().expect("client");
        match client.set_favorite(1, 1, true).await {
            Err(BiliError::NeedsLogin(_)) => {}
            other => panic!("预期 NeedsLogin，实际 {other:?}"),
        }
    }
}
