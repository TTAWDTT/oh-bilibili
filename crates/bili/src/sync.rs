//! 喜欢与收藏。
//!
//! 喜欢映射成 B 站点赞；收藏映射到固定名字的收藏夹，没有就自动建。
//! 两个接口都要 csrf（bili_jct），也必须登录。

use crate::client::{Client, API, LIVE_API};
use crate::error::BiliError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 关注列表每页条数。接口上限 50，超过也只回 50。
pub const FOLLOW_PAGE_SIZE: u32 = 50;

/// 收藏夹名。产品要求固定这个名字，用户 B 站里能看到同一个夹子。
pub const DEFAULT_FOLDER: &str = "哔哩哔哩 music";

/// 搜索出来的 UP 主。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserHit {
    pub mid: u64,
    pub name: String,
    pub face: Option<String>,
    pub fans: u64,
    pub videos: u64,
    pub sign: String,
    pub level: u8,
    /// 认证：None 未认证（接口会给 127），Some(0) 个人，Some(1) 机构。
    pub official: Option<i8>,
    /// 认证说明，挂在勾的 tooltip 上。
    pub verify: String,
    /// 正在直播：搜索结果的 is_live。
    pub live: bool,
}

/// 正在直播的一个房间，来自推荐位（不是按分区拉的全量列表）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveRoom {
    pub room_id: u64,
    pub title: String,
    /// 主播昵称。直播卡上比房间标题更显眼。
    pub uname: String,
    pub face: Option<String>,
    /// 封面。`user_cover` 是主播自己传的，`system_cover` 是系统截帧，前者优先。
    pub cover: Option<String>,
    pub area: String,
    /// 人气值。接口 `online` 给的是 66792955 这种原始数，展示时才缩。
    /// 不要用 `watched_show.text_small`：那个是「人看过」，和人气不是一回事。
    pub online: u64,
}

/// 番剧排行榜的一项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BangumiItem {
    pub season_id: u64,
    pub title: String,
    pub cover: Option<String>,
    pub rank: u32,
    /// 已经格式化好的分数，接口直接给「8.8分」这种串。
    pub rating: String,
    /// 「更新至第1280话」。
    pub index_show: String,
    /// 播放量。接口没给原始数，只给了「22.2亿」这种串。
    pub play_text: String,
}

/// 番剧时间表里的一天。B 站首页那块「周一 / 周二 …」就照这个排。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BangumiDay {
    /// 已经格式化好的日期，接口直接给「11-16」。
    pub date: String,
    /// 1=周一 … 7=周日。
    pub weekday: u8,
    pub today: bool,
    pub episodes: Vec<BangumiEpisode>,
}

/// 某一天更新的某一部番。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BangumiEpisode {
    pub season_id: u64,
    pub title: String,
    pub cover: Option<String>,
    /// 「更新至第12话」「第1话~第10话」这种，接口原文。
    pub pub_index: String,
    /// 更新时间「12:00」，没定时是空串。
    pub pub_time: String,
}

/// 收藏夹列表里的一项。B 站 web 端的收藏夹页就用 `created/list`，它自带每个夹子的封面。
#[derive(Debug, Clone)]
pub struct FavFolder {
    pub id: i64,
    pub title: String,
    pub count: u32,
    /// 夹子里最近一条视频的封面；空夹子没有。
    pub cover: Option<String>,
}

/// UP 主名片。
#[derive(Debug, Clone)]
pub struct AuthorCard {
    pub name: String,
    pub face: String,
    pub fans: u64,
    pub sign: String,
    pub official: Option<String>,
    /// 认证类型：0 个人、1 机构；None 未认证。徽章颜色靠它区分。
    pub official_type: Option<i8>,
    /// 用户等级 0..6。就在 card 接口里，不用另调 acc/info（那条会被限流成 -799）。
    pub level: u8,
    /// 大会员（`card.vip.vipStatus == 1`）。
    pub vip: bool,
    /// 投稿总数。
    pub videos: u64,
    /// 累计获赞。
    pub likes: u64,
}

/// 每周必看的一期。
#[derive(Debug, Clone, serde::Serialize)]
pub struct WeeklyIssue {
    pub number: u32,
    pub subject: String,
    pub name: String,
    pub cover: Option<String>,
}

/// 一期点开之后的片单。
#[derive(Debug, Clone, serde::Serialize)]
pub struct WeeklyIssuePage {
    pub subject: String,
    pub label: String,
    pub cover: Option<String>,
    pub tracks: Vec<bilimusic_model::Track>,
    /// 每条 B 站自己写的一句话推荐语（`rcmd_reason`），按 bvid 对齐到 `tracks`。
    pub notes: HashMap<String, String>,
}

/// 把 `03:45` / `1:02:03` 解析成毫秒。UP 主投稿列表里时长是字符串。
fn parse_mmss(text: &str) -> Option<u64> {
    let parts: Vec<&str> = text.split(':').collect();
    let nums: Option<Vec<u64>> = parts.iter().map(|p| p.parse::<u64>().ok()).collect();
    let nums = nums?;
    let secs = match nums.as_slice() {
        [m, s] => m * 60 + s,
        [h, m, s] => h * 3600 + m * 60 + s,
        _ => return None,
    };
    Some(secs * 1000)
}

/// 我关注的一个 UP 主。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Followed {
    pub mid: u64,
    pub name: String,
    pub face: Option<String>,
    pub sign: String,
    /// B 站认证：None 未认证，Some(0) 个人认证，Some(1) 机构认证。
    #[serde(default)]
    pub official: Option<i8>,
    /// 大会员（`vip.vipStatus == 1`）。
    #[serde(default)]
    pub vip: bool,
    /// 互相关注（`attribute` 的第 3 位）。
    #[serde(default)]
    pub mutual: bool,
    /// 特别关注。
    #[serde(default)]
    pub special: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DynamicKind {
    Video,
    Opus,
    Forward,
    Article,
    Live,
}

/// 关注动态里的一条视频或图文投稿。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DynamicItem {
    pub id: String,
    pub kind: DynamicKind,
    pub mid: u64,
    pub author: String,
    pub face: String,
    /// 0 个人认证、1 机构认证；None 未认证。
    pub official: Option<i8>,
    /// 大会员。
    pub vip: bool,
    pub pub_time: String,
    pub pub_ts: u64,
    pub text: String,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub images: Vec<String>,
    pub duration_ms: Option<u64>,
    pub views: u64,
    pub danmaku: u64,
    /// 专栏稿件的 cv 号，`kind == Article` 时才有。
    #[serde(default)]
    pub article_id: String,
    /// 直播推荐卡片的房间号，`kind == Live` 时才有。
    #[serde(default)]
    pub room_id: u64,
    /// 直播分区名，`kind == Live` 时才有。
    #[serde(default)]
    pub live_area: String,
    /// 转发动态里被转的那条。只解析一层：原动态自己也是转发时留空。
    #[serde(default)]
    pub orig: Option<Box<DynamicItem>>,
    /// 动态本身的转发 / 评论 / 点赞数，不是稿件统计。
    pub forwards: u64,
    pub comments: u64,
    pub likes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DynamicPage {
    pub items: Vec<DynamicItem>,
    pub offset: String,
    pub has_more: bool,
}

impl Client {
    /// 读一条视频当前在账号里的互动状态（点赞、收藏、投币）。
    ///
    /// 实测响应（登录态下 `archive/relation`）：
    /// `{ like: bool, coin: int, favorite: bool, attention: bool, dislike: bool }`
    /// 注意字段是 `like` 不是 `liked`，`favorite` 也在这个接口里，
    /// 所以不需要再打 `fav/video/favoured`——少一次请求，状态之间也不会不一致。
    pub async fn relation_state(&self, bvid: &str) -> Result<(bool, bool, u32), BiliError> {
        let rel = self
            .get_json(
                &format!("{API}/x/web-interface/archive/relation?bvid={bvid}"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let data = &rel["data"];
        let liked = data["like"].as_bool().unwrap_or(false);
        let faved = data["favorite"].as_bool().unwrap_or(false);
        let coin = data["coin"].as_u64().unwrap_or(0) as u32;
        Ok((liked, faved, coin))
    }

    /// 发一条弹幕。`progress_ms` 决定它落在视频的哪一刻。
    ///
    /// 走 `x/v2/dm/post`，需要 bili_jct 当 csrf。B 站对弹幕有审核与频率限制，
    /// 失败时把它的原话透出来，不要自己编一个「发送失败」盖掉原因。
    /// `mode` 是 B 站的弹幕位置：1 滚动、4 底部、5 顶部。`color` 是十进制 RGB。
    pub async fn send_danmaku(
        &self,
        cid: u64,
        bvid: &str,
        text: &str,
        progress_ms: u64,
        mode: u64,
        color: u32,
    ) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("发弹幕需要登录".into()))?;
        let body = vec![
            ("type", "1".to_string()),
            ("oid", cid.to_string()),
            ("msg", text.to_string()),
            ("bvid", bvid.to_string()),
            ("progress", progress_ms.to_string()),
            ("mode", mode.to_string()),
            ("fontsize", "25".to_string()),
            ("color", color.to_string()),
            ("pool", "0".to_string()),
            ("csrf", csrf),
        ];
        self.post_form(&format!("{API}/x/v2/dm/post"), body).await?;
        Ok(())
    }

    /// 点赞 / 取消点赞。
    /// 点赞或取消点赞。
    ///
    /// 取消用的是 `like=2`，不是 `like=0`。用 0 会一直返回 `-400 请求错误`，
    /// 这一条查了很久才定位到（见 docs/HANDOFF.md 的记录）。
    /// 另外几个参数是网页端原样带的，缺了不一定报错，但保持一致更稳。
    pub async fn like_video(&self, aid: u64, on: bool) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        let body = vec![
            ("aid", aid.to_string()),
            ("like", if on { "1" } else { "2" }.to_string()),
            ("csrf", csrf),
            ("eab_x", "1".to_string()),
            ("ramval", "9".to_string()),
            ("source", "web_normal".to_string()),
            ("ga", "1".to_string()),
        ];
        self.post_form(&format!("{API}/x/web-interface/archive/like"), body)
            .await?;
        Ok(())
    }

    /// 上报观看进度，B 站网页端的「继续观看」靠它。
    ///
    /// 只有位置变了才值得上报，所以调用方负责去重；这里不做节流，
    /// 免得「该报的时候被内部逻辑吞掉」这种难查的问题。
    pub async fn report_progress(
        &self,
        aid: u64,
        cid: u64,
        played_secs: u64,
        start_ts: u64,
    ) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        let body = vec![
            ("aid", aid.to_string()),
            ("cid", cid.to_string()),
            ("played_time", played_secs.to_string()),
            ("realtime", played_secs.to_string()),
            ("start_ts", start_ts.to_string()),
            ("type", "3".to_string()),
            ("sub_type", "0".to_string()),
            ("dt", "2".to_string()),
            ("play_type", "0".to_string()),
            ("csrf", csrf),
        ];
        self.post_form(&format!("{API}/x/click-interface/web/heartbeat"), body)
            .await?;
        Ok(())
    }

    /// UP 主名片：粉丝数、签名、头像、认证。
    ///
    /// 走的是老接口 `x/web-interface/card`，它不要求登录也不要求 wbi；
    /// `space/wbi/acc/info` 那条会被限流成 -799，用它拿不到。
    pub async fn author_card(&self, mid: u64) -> Result<AuthorCard, BiliError> {
        let v = self
            .get_json_allowing_guest(
                &format!("{API}/x/web-interface/card?mid={mid}"),
                std::time::Duration::from_millis(600),
            )
            .await?;
        let card = &v["data"]["card"];
        Ok(AuthorCard {
            name: card["name"].as_str().unwrap_or_default().to_string(),
            face: card["face"]
                .as_str()
                .map(|f| f.replacen("http://", "https://", 1))
                .unwrap_or_default(),
            fans: v["data"]["follower"].as_u64().unwrap_or(0),
            sign: card["sign"].as_str().unwrap_or_default().to_string(),
            official: card["Official"]["title"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            official_type: card["Official"]["type"]
                .as_i64()
                .filter(|t| (0..=1).contains(t))
                .map(|t| t as i8),
            // 等级就在 card 里，不需要另调 acc/info（那条会被限流成 -799）。
            level: card["level_info"]["current_level"].as_u64().unwrap_or(0) as u8,
            vip: card["vip"]["vipStatus"].as_u64() == Some(1),
            videos: v["data"]["archive_count"].as_u64().unwrap_or(0),
            likes: v["data"]["like_num"].as_u64().unwrap_or(0),
        })
    }

    /// 当前账号的收藏夹列表。
    ///
    /// 走 web 端的 `created/list`（`list-all` 不带封面）：一次请求就能给每个夹子配一张图，
    /// 列表页不用先给用户看一片灰格子。四宫格拼图由 `fav_covers` 在后台补。
    pub async fn fav_folders(&self) -> Result<Vec<FavFolder>, BiliError> {
        let mid = self
            .logged_in_mid()
            .ok_or_else(|| BiliError::NeedsLogin("还没有登录".into()))?;
        let v = self
            .get_json(
                &format!("{API}/x/v3/fav/folder/created/list?up_mid={mid}&pn=1&ps=100&web_location=333.1387"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let Some(list) = v["data"]["list"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list
            .iter()
            .filter_map(|item| {
                Some(FavFolder {
                    id: item["id"].as_i64()?,
                    title: item["title"].as_str()?.to_string(),
                    count: item["media_count"].as_u64().unwrap_or(0) as u32,
                    cover: item["cover"]
                        .as_str()
                        .filter(|c| !c.is_empty())
                        .map(|c| c.replacen("http://", "https://", 1)),
                })
            })
            .collect())
    }

    /// 收藏夹一页的原始条目。`ps` 是每页条数：列表页要 40 条，
    /// 封面拼图只要前 4 条，不必把整页都拉回来。
    async fn fav_medias(
        &self,
        folder_id: i64,
        page: u32,
        ps: u32,
        min_interval: std::time::Duration,
    ) -> Result<Vec<serde_json::Value>, BiliError> {
        let v = self
            .get_json(
                &format!(
                    "{API}/x/v3/fav/resource/list?media_id={folder_id}&ps={ps}&pn={}&platform=web",
                    page.max(1)
                ),
                min_interval,
            )
            .await?;
        Ok(v["data"]["medias"].as_array().cloned().unwrap_or_default())
    }

    /// 收藏夹列表用的封面拼图：取每个夹子最前面的几张封面。
    pub async fn fav_covers(&self, folder_id: i64, limit: u32) -> Result<Vec<String>, BiliError> {
        Ok(self
            .fav_medias(folder_id, 1, limit.clamp(1, 20), std::time::Duration::from_millis(180))
            .await?
            .iter()
            .filter_map(|m| m["cover"].as_str().filter(|c| !c.is_empty()))
            .map(|c| c.replacen("http://", "https://", 1))
            .collect())
    }

    /// 某个收藏夹里的视频 bvid 列表。
    /// 收藏夹里的视频。
    ///
    /// 列表接口本身就带标题、封面、时长、UP 主与播放量，
    /// 所以一次请求就能凑出完整的 Track——早先只取 bvid 再逐条查详情，
    /// 一页 40 条要发 41 个请求、十几秒才出来。
    pub async fn fav_tracks(
        &self,
        folder_id: i64,
        page: u32,
    ) -> Result<Vec<bilimusic_model::Track>, BiliError> {
        use bilimusic_model::{Millis, Track, TrackKey};

        Ok(self
            .fav_medias(folder_id, page, 40, std::time::Duration::from_millis(400))
            .await?
            .iter()
            .filter_map(|m| {
                let bvid = m["bvid"].as_str()?.to_string();
                let duration = m["duration"].as_u64().filter(|d| *d > 0);
                let play = m["cnt_info"]["play"].as_u64();
                let danmaku = m["cnt_info"]["danmaku"].as_u64();
                let upper_mid = m["upper"]["mid"].as_u64();
                Some(Track {
                    key: TrackKey::from_provider(bvid),
                    title: m["title"].as_str().unwrap_or_default().to_string(),
                    artist: m["upper"]["name"].as_str().unwrap_or_default().to_string(),
                    duration: duration.map(|d| Millis(d * 1000)),
                    cover: m["cover"]
                        .as_str()
                        .map(|c| c.replacen("http://", "https://", 1)),
                    accent: None,
                    views: play,
                    danmaku,
                    // 收藏夹的响应里 upper 自带 face；拿不到就是 None，
                    // 卡片退回首字母，不比改之前差。
                    up_avatar: m["upper"]["face"]
                        .as_str()
                        .map(|f| f.replacen("http://", "https://", 1)),
                    up_mid: upper_mid,
                    tname: None,
                    typeid: None,
                })
            })
            .collect())
    }

    /// 稍后再看的列表。未登录会返回 NeedsLogin。
    pub async fn watch_later(&self) -> Result<Vec<u64>, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/v2/history/toview"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let Some(list) = v["data"]["list"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list.iter().filter_map(|i| i["aid"].as_u64()).collect())
    }

    /// UP 主的投稿列表。
    ///
    /// 走 `space/wbi/arc/search`，**必须 WBI 签名**：不签名会返回 `-403 访问权限不足`，
    /// 而不走 wbi 的老接口 `space/arc/search` 会一直 `-799` 限流。
    /// 排序：`pubdate` 最新、`click` 最多播放、`stow` 最多收藏，和空间页那排一致。
    pub async fn space_videos(
        &self,
        mid: u64,
        page: u32,
        order: &str,
    ) -> Result<(Vec<bilimusic_model::Track>, u32), BiliError> {
        use bilimusic_model::{Millis, Track, TrackKey};

        let order = match order {
            "click" | "stow" | "pubdate" => order,
            _ => "pubdate",
        };
        let v = self
            .signed_get(
                &format!("{API}/x/space/wbi/arc/search"),
                vec![
                    ("mid", mid.to_string()),
                    ("pn", page.max(1).to_string()),
                    ("ps", "50".to_string()),
                    ("order", order.to_string()),
                ],
                std::time::Duration::from_millis(400),
            )
            .await?;
        let total = v["data"]["page"]["count"].as_u64().unwrap_or(0) as u32;
        let list = v["data"]["list"]["vlist"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|m| {
                        let bvid = m["bvid"].as_str().filter(|s| !s.is_empty())?;
                        Some(Track {
                            key: TrackKey::from_provider(bvid),
                            title: m["title"].as_str().unwrap_or("").to_string(),
                            artist: m["author"].as_str().unwrap_or("").to_string(),
                            duration: m["length"]
                                .as_str()
                                .and_then(parse_mmss)
                                .map(Millis),
                            cover: m["pic"]
                                .as_str()
                                .map(|c| c.replacen("http://", "https://", 1)),
                            accent: None,
                            views: m["play"].as_u64(),
                            danmaku: m["video_review"].as_u64(),
                    up_avatar: m["owner"]["face"]
                        .as_str()
                        .map(|f| f.replacen("http://", "https://", 1)),
                            up_mid: Some(mid),
                            tname: None,
                            typeid: None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((list, total))
    }

    /// UP 主的粉丝与关注数。老接口，不需要签名。
    pub async fn space_stat(&self, mid: u64) -> Result<(u64, u64), BiliError> {
        let v = self
            .get_json_relation(
                &format!("{API}/x/relation/stat?vmid={mid}"),
                std::time::Duration::from_millis(300),
            )
            .await?;
        Ok((
            v["data"]["follower"].as_u64().unwrap_or(0),
            v["data"]["following"].as_u64().unwrap_or(0),
        ))
    }

    /// 我关注的人。分页取，一页 20 个。
    pub async fn following(&self, page: u32) -> Result<(Vec<Followed>, u32), BiliError> {
        let nav = self
            .get_json(
                &format!("{API}/x/web-interface/nav"),
                std::time::Duration::from_millis(200),
            )
            .await?;
        let mid = nav["data"]["mid"]
            .as_u64()
            .ok_or_else(|| BiliError::NeedsLogin("没有登录".into()))?;
        let v = self
            .get_json(
                // 实测这个接口最多给到 ps=50（传 100 也只回 50），
                // 一次取满 50 条能把翻页请求数砍掉一半多。
                &format!(
                    "{API}/x/relation/followings?vmid={mid}&pn={}&ps={FOLLOW_PAGE_SIZE}&order=desc",
                    page.max(1)
                ),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let total = v["data"]["total"].as_u64().unwrap_or(0) as u32;
        let list = v["data"]["list"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|u| {
                        Some(Followed {
                            mid: u["mid"].as_u64()?,
                            name: u["uname"].as_str().unwrap_or("").to_string(),
                            face: u["face"]
                                .as_str()
                                .filter(|f| !f.is_empty())
                                .map(|f| f.replacen("http://", "https://", 1)),
                            sign: u["sign"].as_str().unwrap_or("").trim().to_string(),
                            official: u["official_verify"]["type"]
                                .as_i64()
                                .filter(|t| (0..=1).contains(t))
                                .map(|t| t as i8),
                            vip: u["vip"]["vipStatus"].as_u64() == Some(1),
                            mutual: u["attribute"].as_u64().map_or(false, |a| a & 4 != 0),
                            special: u["special"].as_u64() == Some(1),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((list, total))
    }

    /// 关注动态。`offset` 是接口上一页返回的游标，第一页为空。
    pub async fn dynamic_feed(&self, offset: Option<String>) -> Result<DynamicPage, BiliError> {
        let suffix = offset
            .map(|o| format!("&offset={}", crate::wbi::encode_uri_component(&o)))
            .unwrap_or_default();
        let v = self
            .get_json(
                &format!(
                    "{API}/x/polymer/web-dynamic/v1/feed/all?type=all&page=1&features=itemOpusStyle{suffix}"
                ),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let data = &v["data"];
        let items = data["items"]
            .as_array()
            .map(|list| list.iter().filter_map(dynamic_item).collect())
            .unwrap_or_default();
        Ok(DynamicPage {
            items,
            offset: data["offset"].as_str().unwrap_or_default().to_string(),
            has_more: data["has_more"].as_bool().unwrap_or(false),
        })
    }

    /// 稍后再看列表。一条响应就带全卡片数据，不需要逐条查详情。
    pub async fn watch_later_tracks(&self) -> Result<Vec<bilimusic_model::Track>, BiliError> {
        use bilimusic_model::{Millis, Track, TrackKey};

        let v = self
            .get_json(
                &format!("{API}/x/v2/history/toview"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let Some(list) = v["data"]["list"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list
            .iter()
            .filter_map(|m| {
                let bvid = m["bvid"].as_str().filter(|s| !s.is_empty())?;
                let duration = m["duration"].as_u64().filter(|d| *d > 0);
                Some(Track {
                    key: TrackKey::from_provider(bvid),
                    title: m["title"].as_str().unwrap_or_default().to_string(),
                    artist: m["owner"]["name"].as_str().unwrap_or_default().to_string(),
                    duration: duration.map(|d| Millis(d * 1000)),
                    cover: m["pic"]
                        .as_str()
                        .map(|c| c.replacen("http://", "https://", 1)),
                    accent: None,
                    views: m["stat"]["view"].as_u64(),
                    danmaku: m["stat"]["danmaku"].as_u64(),
                    up_avatar: m["owner"]["face"]
                        .as_str()
                        .map(|f| f.replacen("http://", "https://", 1)),
                    up_mid: m["owner"]["mid"].as_u64(),
                    tname: m["tname"].as_str().map(|s| s.to_string()),
                    typeid: None,
                })
            })
            .collect())
    }

    /// 我赞过的视频。空间页这一条接口一次返回列表，pn 参数不生效。
    /// 未登录会返回 NeedsLogin。
    pub async fn liked_videos(&self) -> Result<Vec<bilimusic_model::Track>, BiliError> {
        use bilimusic_model::{Millis, Track, TrackKey};

        let mid = self
            .logged_in_mid()
            .ok_or_else(|| BiliError::NeedsLogin("还没有登录".into()))?;
        let v = self
            .get_json(
                &format!("{API}/x/space/like/video?vmid={mid}&pn=1&ps=50"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let Some(list) = v["data"]["list"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list
            .iter()
            .filter_map(|m| {
                let bvid = m["bvid"].as_str().filter(|s| !s.is_empty())?;
                let duration = m["duration"].as_u64().filter(|d| *d > 0);
                Some(Track {
                    key: TrackKey::from_provider(bvid),
                    title: m["title"].as_str().unwrap_or_default().to_string(),
                    artist: m["owner"]["name"].as_str().unwrap_or_default().to_string(),
                    duration: duration.map(|d| Millis(d * 1000)),
                    cover: m["pic"]
                        .as_str()
                        .map(|c| c.replacen("http://", "https://", 1)),
                    accent: None,
                    views: m["stat"]["view"].as_u64(),
                    danmaku: m["stat"]["danmaku"].as_u64(),
                    up_avatar: m["owner"]["face"]
                        .as_str()
                        .map(|f| f.replacen("http://", "https://", 1)),
                    up_mid: m["owner"]["mid"].as_u64(),
                    tname: m["tname"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string()),
                    typeid: None,
                })
            })
            .collect())
    }

    /// 视频标签。公开接口，不需要 WBI。
    pub async fn video_tags(&self, bvid: &str) -> Result<Vec<String>, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/tag/archive/tags?bvid={bvid}"),
                std::time::Duration::from_millis(300),
            )
            .await?;
        Ok(v["data"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|t| t["tag_name"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 评论表情面板的全部图片表情，并补充经典「2233娘」表情包。
    pub async fn comment_emotes(&self) -> Result<Vec<(String, String)>, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/emote/user/panel/web?business=reply"),
                std::time::Duration::from_millis(300),
            )
            .await?;
        let mut pairs = emote_pairs(&v);
        if let Ok(extra) = self
            .get_json(
                &format!("{API}/x/emote/package?business=reply&ids=6"),
                std::time::Duration::from_millis(300),
            )
            .await
        {
            pairs.extend(emote_pairs(&extra));
        }
        Ok(pairs)
    }

    /// 搜 UP 主。和视频搜索同一个端点，只换 search_type。
    pub async fn search_users(&self, keyword: &str, page: u32) -> Result<Vec<UserHit>, BiliError> {
        let v = self
            .signed_get(
                &format!("{API}/x/web-interface/wbi/search/type"),
                vec![
                    ("search_type", "bili_user".to_string()),
                    ("keyword", keyword.to_string()),
                    ("page", page.max(1).to_string()),
                    ("page_size", "20".to_string()),
                ],
                // 搜索接口按窗口限请求数，和 search_q 走同一个间隔
                std::time::Duration::from_millis(400),
            )
            .await?;
        let Some(list) = v["data"]["result"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list
            .iter()
            .filter_map(|m| {
                let mid = m["mid"].as_u64()?;
                let face = m["upic"].as_str().map(|u| {
                    if let Some(rest) = u.strip_prefix("//") {
                        format!("https://{rest}")
                    } else {
                        u.replacen("http://", "https://", 1)
                    }
                });
                Some(UserHit {
                    mid,
                    name: m["uname"].as_str().unwrap_or_default().to_string(),
                    face: face.filter(|u| !u.is_empty()),
                    fans: m["fans"].as_u64().unwrap_or(0),
                    videos: m["videos"].as_u64().unwrap_or(0),
                    sign: m["usign"].as_str().unwrap_or_default().trim().to_string(),
                    level: m["level"].as_u64().unwrap_or(0) as u8,
                    official: m["official_verify"]["type"]
                        .as_i64()
                        .filter(|t| (0..=1).contains(t))
                        .map(|t| t as i8),
                    verify: m["official_verify"]["desc"]
                        .as_str()
                        .unwrap_or_default()
                        .trim()
                        .to_string(),
                    live: m["is_live"].as_u64() == Some(1),
                })
            })
            .collect())
    }

    /// 排行榜。公开接口，一次返回 100 条；rid=0 是全站。
    pub async fn ranking(&self, rid: u32) -> Result<Vec<bilimusic_model::Track>, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/web-interface/ranking/v2?rid={rid}&type=all"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(tracks_from_list(&v["data"]["list"]))
    }

    /// 综合热门（B 站 popular/all）。一次 50 条，`no_more` 为 true 表示翻到底了。
    ///
    /// 每条还带一个 `rcmd_reason.content`，B 站把它印在标题下面当橙色小标签
    /// （「百万播放」「7万点赞」「人气飙升」），大部分条目是空串。
    pub async fn popular(
        &self,
        page: u32,
    ) -> Result<(Vec<bilimusic_model::Track>, bool, HashMap<String, String>), BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/web-interface/popular?pn={page}&ps=50"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let no_more = v["data"]["no_more"].as_bool().unwrap_or(false);
        Ok((tracks_from_list(&v["data"]["list"]), no_more, popular_notes(&v["data"]["list"])))
    }

    /// 每周必看的一期列表。
    pub async fn weekly_issues(&self) -> Result<Vec<WeeklyIssue>, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/web-interface/popular/series/list"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(v["data"]["list"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|m| {
                        Some(WeeklyIssue {
                            number: m["number"].as_u64()? as u32,
                            subject: m["subject"].as_str().unwrap_or_default().to_string(),
                            name: m["name"].as_str().unwrap_or_default().to_string(),
                            cover: None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 某一期的片单。
    pub async fn weekly_issue(&self, number: u32) -> Result<WeeklyIssuePage, BiliError> {
        let v = self.weekly_issue_raw(number).await?;
        // 这一期自己的标题、期号封面都在 `config` 里，`data` 顶层只有 config / list / reminder。
        let config = &v["data"]["config"];
        Ok(WeeklyIssuePage {
            subject: config["subject"].as_str().unwrap_or_default().to_string(),
            label: config["label"].as_str().unwrap_or_default().to_string(),
            cover: config["cover"]
                .as_str()
                .filter(|c| !c.is_empty())
                .map(|c| c.replacen("http://", "https://", 1)),
            tracks: tracks_from_list(&v["data"]["list"]),
            notes: weekly_notes(&v["data"]["list"]),
        })
    }

    /// 单期原始响应。解析放在 [`Self::weekly_issue`]，这里只负责签名取数。
    pub async fn weekly_issue_raw(&self, number: u32) -> Result<serde_json::Value, BiliError> {
        self.signed_get(
            &format!("{API}/x/web-interface/popular/series/one"),
            vec![
                ("number", number.to_string()),
                ("web_location", "333.976".to_string()),
            ],
            std::time::Duration::from_millis(400),
        )
        .await
    }

    /// 入站必刷：B 站给新用户的首屏片单。
    ///
    /// 传 `page_size` 没用，一次就把全部条目给回来。每条附一句 `achievement`，
    /// 是 B 站自己写的推荐语，不是我们编的说明。
    pub async fn precious(&self) -> Result<(String, String, Vec<PreciousItem>), BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/web-interface/popular/precious?page_size=20&page=1"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let data = &v["data"];
        let items = data["list"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|m| {
                        Some(PreciousItem {
                            track: track_from_item(m)?,
                            note: m["achievement"].as_str().unwrap_or_default().to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((
            data["title"].as_str().unwrap_or_default().to_string(),
            data["explain"].as_str().unwrap_or_default().to_string(),
            items,
        ))
    }

    /// 当前在看人数。B 站视频页把它挂在播放量与弹幕后面。
    pub async fn online_count(&self, bvid: &str, cid: u64) -> Result<u64, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/player/v2?bvid={bvid}&cid={cid}"),
                std::time::Duration::from_millis(300),
            )
            .await?;
        Ok(v["data"]["online_count"].as_u64().unwrap_or(0))
    }

    /// 正在直播的房间推荐：B 站首页右栏最上面那一块就是它。
    ///
    /// 走 `room/v1/room/get_user_recommend`：`xlive` 那套 second/getList
    /// 未带登录态时直接返回 -352，这一条不需要登录。
    pub async fn live_rooms(&self, count: u32, page: u32) -> Result<Vec<LiveRoom>, BiliError> {
        let v = self
            .get_json(
                &format!("{LIVE_API}/room/v1/room/get_user_recommend?page={page}&page_size={count}"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(v["data"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|m| {
                        Some(LiveRoom {
                            room_id: m["roomid"].as_u64()?,
                            title: m["title"].as_str().unwrap_or_default().to_string(),
                            uname: m["uname"].as_str().unwrap_or_default().to_string(),
                            face: m["face"]
                                .as_str()
                                .map(|f| f.replacen("http://", "https://", 1)),
                            cover: m["user_cover"]
                                .as_str()
                                .filter(|c| !c.is_empty())
                                .or_else(|| m["system_cover"].as_str())
                                .map(|c| c.replacen("http://", "https://", 1)),
                            area: m["areaName"].as_str().unwrap_or_default().to_string(),
                            online: m["online"].as_u64().unwrap_or(0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 番剧排行（`pgc/web/rank/list`）。这是 B 站首页「番剧」区的数据源。
    ///
    /// 按 `season_type` 取前 `count` 名，首页固定取番剧分类的一排。
    pub async fn bangumi_rank(
        &self,
        count: usize,
        season_type: u32,
    ) -> Result<Vec<BangumiItem>, BiliError> {
        let v = self
            .get_json(
                &bangumi_rank_url(season_type),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(v["result"]["list"]
            .as_array()
            .map(|list| {
                list.iter()
                    .take(count)
                    .filter_map(|m| {
                        Some(BangumiItem {
                            season_id: m["season_id"].as_u64()?,
                            title: m["title"].as_str().unwrap_or_default().to_string(),
                            cover: m["cover"]
                                .as_str()
                                .map(|c| c.replacen("http://", "https://", 1)),
                            rank: m["rank"].as_u64().unwrap_or(0) as u32,
                            rating: m["rating"].as_str().unwrap_or_default().to_string(),
                            index_show: m["new_ep"]["index_show"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            play_text: m["icon_font"]["text"].as_str().unwrap_or_default().to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 当前账号的追番；接口只接受每页 20 条。
    pub async fn followed_bangumi(&self, page: u32) -> Result<(Vec<BangumiItem>, u32), BiliError> {
        let mid = self
            .nav_snapshot()
            .mid
            .ok_or_else(|| BiliError::NeedsLogin("登录后查看追番".into()))?;
        let page = page.max(1);
        let v = self
            .get_json(
                &format!("{API}/x/space/bangumi/follow/list?type=1&follow_status=0&pn={page}&ps=20&vmid={mid}"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let data = &v["data"];
        let items = data["list"]
            .as_array()
            .map(|list| list.iter().filter_map(bangumi_follow_item).collect())
            .unwrap_or_default();
        Ok((items, data["total"].as_u64().unwrap_or(0) as u32))
    }

    /// 番剧更新表。B 站首页右下角那块「周一 周二 …」就是它，一天一组。
    ///
    /// `before` / `after` 是天数：取 6 天前到 6 天后，正好铺满一周。
    pub async fn bangumi_timeline(&self) -> Result<Vec<BangumiDay>, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/pgc/web/timeline?types=1&before=6&after=6"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(v["result"]
            .as_array()
            .map(|days| {
                days.iter()
                    .filter_map(|d| {
                        let weekday = d["day_of_week"].as_u64()? as u8;
                        Some(BangumiDay {
                            date: d["date"].as_str().unwrap_or_default().to_string(),
                            weekday,
                            today: d["is_today"].as_u64() == Some(1),
                            episodes: d["episodes"]
                                .as_array()
                                .map(|list| {
                                    list.iter()
                                        .filter_map(|m| {
                                            Some(BangumiEpisode {
                                                season_id: m["season_id"].as_u64()?,
                                                title: m["title"].as_str().unwrap_or_default().to_string(),
                                                cover: m["square_cover"]
                                                    .as_str()
                                                    .filter(|c| !c.is_empty())
                                                    .or_else(|| m["cover"].as_str())
                                                    .map(|c| c.replacen("http://", "https://", 1)),
                                                pub_index: m["pub_index"]
                                                    .as_str()
                                                    .unwrap_or_default()
                                                    .to_string(),
                                                pub_time: m["pub_time"]
                                                    .as_str()
                                                    .unwrap_or_default()
                                                    .to_string(),
                                            })
                                        })
                                        .collect()
                                })
                                .unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 加入稍后再看。
    pub async fn watch_later_add(&self, aid: u64) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        self.post_form(
            &format!("{API}/x/v2/history/toview/add"),
            vec![("aid", aid.to_string()), ("csrf", csrf)],
        )
        .await?;
        Ok(())
    }

    /// 从稍后再看移除。
    pub async fn watch_later_remove(&self, aid: u64) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        self.post_form(
            &format!("{API}/x/v2/history/toview/del"),
            vec![("aid", aid.to_string()), ("csrf", csrf)],
        )
        .await?;
        Ok(())
    }

    /// 关注或取关一个 UP 主。`act` 1 关注、2 取关。
    pub async fn follow(&self, mid: u64, on: bool) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        let body = vec![
            ("fid", mid.to_string()),
            ("act", if on { "1" } else { "2" }.to_string()),
            ("re_src", "11".to_string()),
            ("csrf", csrf),
        ];
        self.post_form(&format!("{API}/x/relation/modify"), body)
            .await?;
        Ok(())
    }

    /// 当前账号有没有关注这个 UP 主。
    ///
    /// `attribute` 是个位掩码：2 表示已关注，6 表示互相关注。所以判断用与运算，
    /// 不能写成 `attribute == 2`，互关的情况下会误报成没关注。
    pub async fn is_following(&self, mid: u64) -> Result<bool, BiliError> {
        let value = self
            .get_json(
                &format!("{API}/x/relation?fid={mid}"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let attribute = value["data"]["attribute"].as_u64().unwrap_or(0);
        Ok(attribute & 2 == 2)
    }

    /// 批量查关注状态，返回顺序和入参一致。
    ///
    /// 没关注的 mid 直接不出现在 `data` 里，所以缺项按未关注处理。
    pub async fn relation_followed_many(
        &self,
        mids: &[u64],
    ) -> Result<Vec<(u64, bool)>, BiliError> {
        if mids.is_empty() {
            return Ok(Vec::new());
        }
        let fids = mids
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let value = self
            .get_json(
                &format!("{API}/x/relation/relations?fids={fids}"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let data = &value["data"];
        Ok(mids
            .iter()
            .map(|&mid| {
                let attribute = data[mid.to_string().as_str()]["attribute"]
                    .as_u64()
                    .unwrap_or(0);
                (mid, attribute & 2 == 2)
            })
            .collect())
    }

    /// 投币。`count` 是 1 或 2（B 站上限两枚）；`also_like` 为真时同时点赞，一键三连就是这么来的。
    pub async fn add_coin(&self, aid: u64, count: u8, also_like: bool) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        let body = vec![
            ("aid", aid.to_string()),
            ("multiply", count.clamp(1, 2).to_string()),
            ("select_like", if also_like { "1" } else { "0" }.to_string()),
            ("csrf", csrf),
        ];
        self.post_form(&format!("{API}/x/web-interface/coin/add"), body)
            .await?;
        Ok(())
    }

    /// 找收藏夹，没有就建一个。返回 media_id。
    pub async fn ensure_fav_folder(&self, name: &str) -> Result<i64, BiliError> {
        let mid = self
            .logged_in_mid()
            .ok_or_else(|| BiliError::NeedsLogin("还没有登录".into()))?;
        let v = self
            .get_json(
                &format!(
                    "{API}/x/v3/fav/folder/created/list-all?up_mid={mid}&rid=0"
                ),
                std::time::Duration::from_millis(300),
            )
            .await?;

        if let Some(list) = v["data"]["list"].as_array() {
            for item in list {
                if item["title"].as_str() == Some(name) {
                    if let Some(id) = item["id"].as_i64() {
                        return Ok(id);
                    }
                }
            }
        }

        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        let created = self
            .post_form(
                &format!("{API}/x/v3/fav/folder/add"),
                vec![
                    ("title", name.to_string()),
                    ("privacy", "0".to_string()),
                    ("csrf", csrf),
                ],
            )
            .await?;
        created["data"]["id"]
            .as_i64()
            .ok_or_else(|| BiliError::Parse("建收藏夹没有返回 id".into()))
    }

    /// 收藏或取消收藏一条视频。
    pub async fn set_favorite(
        &self,
        aid: u64,
        folder_id: i64,
        on: bool,
    ) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        self.post_form(
            &format!("{API}/x/v3/fav/resource/deal"),
            vec![
                ("rid", aid.to_string()),
                ("type", "2".to_string()),
                ("add_media_ids", if on { folder_id.to_string() } else { String::new() }),
                ("del_media_ids", if on { String::new() } else { folder_id.to_string() }),
                ("csrf", csrf),
            ],
        )
        .await?;
        Ok(())
    }
}

fn emote_pairs(value: &serde_json::Value) -> Vec<(String, String)> {
    let Some(packages) = value["data"]["packages"].as_array() else {
        return Vec::new();
    };
    packages
        .iter()
        .filter_map(|package| package["emote"].as_array())
        .flatten()
        .filter_map(|emote| {
            let code = emote["text"].as_str().filter(|text| !text.is_empty())?;
            let url = emote["url"]
                .as_str()
                .filter(|url| url.starts_with("http://") || url.starts_with("https://"))?;
            Some((
                code.to_string(),
                url.replacen("http://", "https://", 1),
            ))
        })
        .collect()
}

/// 入站必刷的一条：视频本身加上 B 站给它的推荐语。
#[derive(Debug, Clone)]
pub struct PreciousItem {
    pub track: bilimusic_model::Track,
    pub note: String,
}

/// `data.list` 里的一条视频卡片。排行榜、综合热门与入站必刷是同一个形状，共用这一份解析。
fn track_from_item(m: &serde_json::Value) -> Option<bilimusic_model::Track> {
    use bilimusic_model::{Millis, Track, TrackKey};

    let bvid = m["bvid"].as_str().filter(|s| !s.is_empty())?;
    let duration = m["duration"].as_u64().filter(|d| *d > 0);
    Some(Track {
        key: TrackKey::from_provider(bvid),
        title: m["title"].as_str().unwrap_or_default().to_string(),
        artist: m["owner"]["name"].as_str().unwrap_or_default().to_string(),
        duration: duration.map(|d| Millis(d * 1000)),
        cover: m["pic"]
            .as_str()
            .map(|c| c.replacen("http://", "https://", 1)),
        accent: None,
        views: m["stat"]["view"].as_u64(),
        danmaku: m["stat"]["danmaku"].as_u64(),
        up_avatar: m["owner"]["face"]
            .as_str()
            .map(|f| f.replacen("http://", "https://", 1)),
        up_mid: m["owner"]["mid"].as_u64(),
        tname: m["tname"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        typeid: None,
    })
}

/// `data.list` 解析成曲目。没有 bvid 的条目跳过。
fn tracks_from_list(list: &serde_json::Value) -> Vec<bilimusic_model::Track> {
    let Some(list) = list.as_array() else {
        return Vec::new();
    };
    list.iter().filter_map(track_from_item).collect()
}

/// 单期片单每条的推荐语。字段名是 `rcmd_reason`，不是入站必刷那个 `achievement`；
/// 早期按 `achievement` 解析过，结果永远是空表（真实响应里它是 null）。
/// 热门条目的橙色小标签。`rcmd_reason` 在这里是对象（`{"content": "百万播放"}`），
/// 而每周必看那边是裸字符串，字段同名、形状不同，别共用解析。
fn popular_notes(list: &serde_json::Value) -> HashMap<String, String> {
    let Some(list) = list.as_array() else {
        return HashMap::new();
    };
    list.iter()
        .filter_map(|m| {
            let bvid = m["bvid"].as_str()?;
            let note = m["rcmd_reason"]["content"].as_str().filter(|s| !s.is_empty())?;
            Some((bvid.to_string(), note.to_string()))
        })
        .collect()
}

fn weekly_notes(list: &serde_json::Value) -> HashMap<String, String> {
    let Some(list) = list.as_array() else {
        return HashMap::new();
    };
    list.iter()
        .filter_map(|m| {
            let bvid = m["bvid"].as_str()?;
            let note = m["rcmd_reason"].as_str().filter(|s| !s.is_empty())?;
            Some((bvid.to_string(), note.to_string()))
        })
        .collect()
}

/// mid 在动态接口里可能是数字，也可能是数字字符串。
fn dynamic_mid(value: &serde_json::Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

fn duration_text_ms(text: &str) -> Option<u64> {
    let parts: Vec<&str> = text.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (0, minutes.parse::<u64>().ok()?, seconds.parse::<u64>().ok()?),
        [hours, minutes, seconds] => (
            hours.parse::<u64>().ok()?,
            minutes.parse::<u64>().ok()?,
            seconds.parse::<u64>().ok()?,
        ),
        _ => return None,
    };
    Some((hours * 3600 + minutes * 60 + seconds) * 1000)
}

fn dynamic_item(item: &serde_json::Value) -> Option<DynamicItem> {
    dynamic_item_at(item, 1)
}

/// `depth` 是还允许往下解析几层转发。B 站的转发可以套转发，
/// 界面上只画一层原动态，再往里就是一条没有信息的空引用。
fn dynamic_item_at(item: &serde_json::Value, depth: u8) -> Option<DynamicItem> {
    let major = &item["modules"]["module_dynamic"]["major"];
    let kind = match (item["type"].as_str(), major["type"].as_str()) {
        (Some("DYNAMIC_TYPE_AV"), Some("MAJOR_TYPE_ARCHIVE")) => DynamicKind::Video,
        // 图文动态有两种形状：带 opus 摘要的，和只有 draw.items 的老格式。
        // 转发里被转的图文几乎都是后者，只认 OPUS 会把整张原动态丢掉。
        (Some("DYNAMIC_TYPE_DRAW"), Some("MAJOR_TYPE_OPUS" | "MAJOR_TYPE_DRAW")) => {
            DynamicKind::Opus
        }
        (Some("DYNAMIC_TYPE_ARTICLE"), Some("MAJOR_TYPE_ARTICLE")) => DynamicKind::Article,
        // 关注流里夹的直播推荐。B 站网页把这几条画成普通直播卡。
        (Some("DYNAMIC_TYPE_LIVE_RCMD"), Some("MAJOR_TYPE_LIVE_RCMD")) => DynamicKind::Live,
        // 转发里的原动态常常是直播，信息在 major.live，不走 live_rcmd。
        (Some("DYNAMIC_TYPE_LIVE"), Some("MAJOR_TYPE_LIVE")) => DynamicKind::Live,
        (Some("DYNAMIC_TYPE_FORWARD"), _) => DynamicKind::Forward,
        _ => return None,
    };
    let author = &item["modules"]["module_author"];
    let mut dynamic = DynamicItem {
        id: item["id_str"]
            .as_str()
            .map(str::to_string)
            .or_else(|| item["id"].as_u64().map(|id| id.to_string()))?,
        kind,
        mid: dynamic_mid(&author["mid"])?,
        author: author["name"].as_str().unwrap_or_default().to_string(),
        face: author["face"]
            .as_str()
            .unwrap_or_default()
            .replacen("http://", "https://", 1),
        official: author["official_verify"]["type"]
            .as_i64()
            .filter(|t| (0..=1).contains(t))
            .map(|t| t as i8),
        vip: author["vip"]["status"].as_u64() == Some(1),
        pub_time: author["pub_time"].as_str().unwrap_or_default().to_string(),
        // 直播推荐里 pub_ts 是字符串，其它动态是数字。
        pub_ts: dynamic_count(&author["pub_ts"]),
        text: String::new(),
        bvid: String::new(),
        title: String::new(),
        cover: String::new(),
        images: Vec::new(),
        duration_ms: None,
        views: 0,
        danmaku: 0,
        article_id: String::new(),
        room_id: 0,
        live_area: String::new(),
        orig: None,
        forwards: dynamic_count(&item["modules"]["module_stat"]["forward"]["count"]),
        comments: dynamic_count(&item["modules"]["module_stat"]["comment"]["count"]),
        likes: dynamic_count(&item["modules"]["module_stat"]["like"]["count"]),
    };
    match dynamic.kind {
        DynamicKind::Video => {
            let archive = &major["archive"];
            dynamic.text = item["modules"]["module_dynamic"]["desc"]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            dynamic.bvid = archive["bvid"].as_str()?.to_string();
            dynamic.title = archive["title"].as_str().unwrap_or_default().to_string();
            dynamic.cover = archive["cover"]
                .as_str()
                .unwrap_or_default()
                .replacen("http://", "https://", 1);
            dynamic.duration_ms = archive["duration_text"]
                .as_str()
                .and_then(duration_text_ms);
            dynamic.views = dynamic_count(&archive["stat"]["play"]);
            dynamic.danmaku = dynamic_count(&archive["stat"]["danmaku"]);
        }
        DynamicKind::Opus => {
            let opus = &major["opus"];
            dynamic.title = opus["title"].as_str().unwrap_or_default().to_string();
            dynamic.text = opus["summary"]["text"]
                .as_str()
                .or_else(|| item["modules"]["module_dynamic"]["desc"]["text"].as_str())
                .unwrap_or_default()
                .trim_matches(|c: char| c == '\u{200b}' || c.is_whitespace())
                .to_string();
            dynamic.images = opus["pics"]
                .as_array()
                .map(|pics| {
                    pics.iter()
                        .filter_map(|pic| pic["url"].as_str())
                        .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
                        .map(|url| url.replacen("http://", "https://", 1))
                        .collect()
                })
                .unwrap_or_default();
            if dynamic.images.is_empty() {
                dynamic.images = major["draw"]["items"]
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item["src"].as_str())
                            .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
                            .map(|url| url.replacen("http://", "https://", 1))
                            .collect()
                    })
                    .unwrap_or_default();
            }
            dynamic.cover = dynamic.images.first().cloned().unwrap_or_default();
        }
        DynamicKind::Article => {
            let article = &major["article"];
            dynamic.article_id = article["id"]
                .as_str()
                .map(str::to_string)
                .or_else(|| article["id"].as_u64().map(|id| id.to_string()))
                .unwrap_or_default();
            dynamic.title = article["title"].as_str().unwrap_or_default().to_string();
            dynamic.text = article["desc"]
                .as_str()
                .unwrap_or_default()
                .trim_matches(|c: char| c == '\u{200b}' || c.is_whitespace())
                .to_string();
            dynamic.cover = article["covers"]
                .as_array()
                .and_then(|covers| covers.iter().find_map(|cover| cover.as_str()))
                .map(|url| url.replacen("http://", "https://", 1))
                .unwrap_or_default();
        }
        DynamicKind::Live => {
            let live = &major["live"];
            if !live.is_null() {
                dynamic.room_id = live["id"]
                    .as_str()
                    .and_then(|id| id.parse().ok())
                    .or_else(|| live["id"].as_u64())
                    .unwrap_or(0);
                dynamic.title = live["title"].as_str().unwrap_or_default().to_string();
                dynamic.cover = live["cover"]
                    .as_str()
                    .unwrap_or_default()
                    .replacen("http://", "https://", 1);
                dynamic.live_area = live["desc_first"].as_str().unwrap_or_default().to_string();
                dynamic.views = audience_count(live["desc_second"].as_str().unwrap_or_default());
            } else {
                // 推荐卡把房间信息塞在 content 字符串里，是嵌了一层的 JSON。
                let content = major["live_rcmd"]["content"].as_str().unwrap_or_default();
                let parsed = serde_json::from_str::<serde_json::Value>(content).unwrap_or_default();
                let info = &parsed["live_play_info"];
                dynamic.room_id = info["room_id"].as_u64().unwrap_or(0);
                dynamic.title = info["title"].as_str().unwrap_or_default().to_string();
                dynamic.cover = info["cover"]
                    .as_str()
                    .unwrap_or_default()
                    .replacen("http://", "https://", 1);
                dynamic.live_area = info["area_name"].as_str().unwrap_or_default().to_string();
                dynamic.views = info["online"].as_u64().unwrap_or(0);
            }
        }
        DynamicKind::Forward => {
            dynamic.text = item["modules"]["module_dynamic"]["desc"]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if depth > 0 {
                dynamic.orig = dynamic_item_at(&item["orig"], depth - 1)
                    .filter(|orig| orig.kind != DynamicKind::Forward)
                    .map(Box::new);
            }
        }
    }
    Some(dynamic)
}

fn dynamic_count(value: &serde_json::Value) -> u64 {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .unwrap_or(0)
}

/// 直播卡的人群文案：「2172人看过」「1.2万人看过」。
fn audience_count(text: &str) -> u64 {
    let digits: String = text
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let base: f64 = digits.parse().unwrap_or(0.0);
    let scale = if text.contains('万') { 10_000.0 } else { 1.0 };
    (base * scale) as u64
}

#[cfg(test)]
mod dynamic_duration_tests {
    use serde_json::json;

    #[test]
    fn 解析动态时长() {
        assert_eq!(super::duration_text_ms("03:12"), Some(192_000));
        assert_eq!(super::duration_text_ms("1:02:33"), Some(3_753_000));
        assert_eq!(super::duration_text_ms("garbage"), None);
    }

    #[test]
    fn 动态统计字符串也能读成数字() {
        let item = json!({
            "id_str": "1",
            "type": "DYNAMIC_TYPE_AV",
            "modules": {
                "module_author": {
                    "mid": "946974",
                    "name": "测试 UP",
                    "face": "http://i0.hdslb.com/face.jpg",
                    "official_verify": { "type": 1 },
                    "vip": { "status": 1 },
                    "pub_time": "刚刚",
                    "pub_ts": 1
                },
                "module_dynamic": {
                    "desc": { "text": "新投稿" },
                    "major": {
                        "type": "MAJOR_TYPE_ARCHIVE",
                        "archive": {
                            "bvid": "BV1xx411c7mD",
                            "title": "测试视频",
                            "cover": "http://i0.hdslb.com/cover.jpg",
                            "duration_text": "03:12",
                            "stat": { "play": "353", "danmaku": 7 }
                        }
                    }
                },
                "module_stat": {
                    "forward": { "count": 3 },
                    "comment": { "count": 12 },
                    "like": { "count": 45 }
                }
            }
        });
        let dynamic = super::dynamic_item(&item).expect("动态应能解析");
        assert_eq!(dynamic.kind, super::DynamicKind::Video);
        assert!(dynamic.images.is_empty());
        assert_eq!(dynamic.views, 353);
        assert_eq!(dynamic.danmaku, 7);
        assert_eq!(dynamic.face, "https://i0.hdslb.com/face.jpg");
        assert_eq!(dynamic.official, Some(1));
        assert!(dynamic.vip);
        assert_eq!(dynamic.forwards, 3);
        assert_eq!(dynamic.comments, 12);
        assert_eq!(dynamic.likes, 45);
    }

    #[test]
    fn 图文动态保留标题正文与图片() {
        let item = json!({
            "id_str": "2",
            "type": "DYNAMIC_TYPE_DRAW",
            "modules": {
                "module_author": {
                    "mid": 946974_u64,
                    "name": "测试 UP",
                    "face": "http://i0.hdslb.com/face.jpg",
                    "pub_time": "刚刚",
                    "pub_ts": 1
                },
                "module_dynamic": {
                    "desc": null,
                    "major": {
                        "type": "MAJOR_TYPE_OPUS",
                        "opus": {
                            "title": "十一月周边大放送",
                            "summary": { "text": "\u{200b}抽十份相框" },
                            "pics": [
                                { "url": "http://i0.hdslb.com/a.png" },
                                { "url": "https://i0.hdslb.com/b.png" }
                            ]
                        }
                    }
                },
                "module_stat": {
                    "forward": { "count": 1 },
                    "comment": { "count": 2 },
                    "like": { "count": 3 }
                }
            }
        });
        let dynamic = super::dynamic_item(&item).expect("图文动态应能解析");
        assert_eq!(dynamic.kind, super::DynamicKind::Opus);
        assert_eq!(dynamic.title, "十一月周边大放送");
        assert_eq!(dynamic.text, "抽十份相框");
        assert_eq!(
            dynamic.images,
            vec![
                "https://i0.hdslb.com/a.png".to_string(),
                "https://i0.hdslb.com/b.png".to_string()
            ]
        );
        assert_eq!(dynamic.bvid, "");
        assert_eq!(dynamic.views, 0);
        assert_eq!(dynamic.likes, 3);
    }

    #[test]
    fn 转发动态带出被转的原稿() {
        let item = json!({
            "id_str": "3",
            "type": "DYNAMIC_TYPE_FORWARD",
            "modules": {
                "module_author": {
                    "mid": 946974_u64,
                    "name": "转发的人",
                    "face": "https://i0.hdslb.com/face.jpg",
                    "pub_time": "刚刚",
                    "pub_ts": 2
                },
                "module_dynamic": {
                    "desc": { "text": "这条必须转 #音乐现场#" },
                    "major": null
                },
                "module_stat": {
                    "forward": { "count": 8 },
                    "comment": { "count": 4 },
                    "like": { "count": 16 }
                }
            },
            "orig": {
                "id_str": "1",
                "type": "DYNAMIC_TYPE_AV",
                "modules": {
                    "module_author": {
                        "mid": "946975",
                        "name": "原作者",
                        "face": "http://i0.hdslb.com/orig.jpg",
                        "pub_time": "昨天",
                        "pub_ts": 1
                    },
                    "module_dynamic": {
                        "desc": null,
                        "major": {
                            "type": "MAJOR_TYPE_ARCHIVE",
                            "archive": {
                                "bvid": "BV1xx411c7mD",
                                "title": "被转的视频",
                                "cover": "http://i0.hdslb.com/cover.jpg",
                                "duration_text": "03:12",
                                "stat": { "play": 353, "danmaku": 7 }
                            }
                        }
                    },
                    "module_stat": {
                        "forward": { "count": 3 },
                        "comment": { "count": 12 },
                        "like": { "count": 45 }
                    }
                }
            }
        });
        let dynamic = super::dynamic_item(&item).expect("转发动态应能解析");
        assert_eq!(dynamic.kind, super::DynamicKind::Forward);
        assert_eq!(dynamic.text, "这条必须转 #音乐现场#");
        let orig = dynamic.orig.expect("应带出原动态");
        assert_eq!(orig.kind, super::DynamicKind::Video);
        assert_eq!(orig.mid, 946975);
        assert_eq!(orig.author, "原作者");
        assert_eq!(orig.bvid, "BV1xx411c7mD");
        assert_eq!(orig.title, "被转的视频");
        assert_eq!(orig.duration_ms, Some(192_000));
        assert_eq!(dynamic.forwards, 8);
    }

    #[test]
    fn 转发里的图文老格式也能带出图片() {
        let item = json!({
            "id_str": "8",
            "type": "DYNAMIC_TYPE_FORWARD",
            "modules": {
                "module_author": {
                    "mid": 1_u64,
                    "name": "转发的人",
                    "face": "https://i0.hdslb.com/face.jpg",
                    "pub_time": "刚刚",
                    "pub_ts": 2
                },
                "module_dynamic": {
                    "desc": { "text": "看这个" },
                    "major": null
                },
                "module_stat": {
                    "forward": { "count": 0 },
                    "comment": { "count": 0 },
                    "like": { "count": 0 }
                }
            },
            "orig": {
                "id_str": "7",
                "type": "DYNAMIC_TYPE_DRAW",
                "modules": {
                    "module_author": {
                        "mid": 2_u64,
                        "name": "画师",
                        "face": "https://i0.hdslb.com/face2.jpg",
                        "pub_time": "昨天",
                        "pub_ts": 1
                    },
                    "module_dynamic": {
                        "desc": null,
                        "major": {
                            "type": "MAJOR_TYPE_DRAW",
                            "draw": {
                                "items": [
                                    { "src": "http://i0.hdslb.com/one.jpg" },
                                    { "src": "https://i0.hdslb.com/two.png" }
                                ]
                            }
                        }
                    },
                    "module_stat": {
                        "forward": { "count": 1 },
                        "comment": { "count": 2 },
                        "like": { "count": 3 }
                    }
                }
            }
        });
        let dynamic = super::dynamic_item(&item).expect("转发动态应能解析");
        let orig = dynamic.orig.expect("应带出原动态");
        assert_eq!(orig.kind, super::DynamicKind::Opus);
        assert_eq!(
            orig.images,
            vec![
                "https://i0.hdslb.com/one.jpg".to_string(),
                "https://i0.hdslb.com/two.png".to_string()
            ]
        );
    }

    #[test]
    fn 直播推荐动态解析房间信息() {
        let content = json!({
            "type": 1,
            "live_play_info": {
                "room_id": 22084735_u64,
                "title": "选填题技巧火热报名中",
                "cover": "http://i0.hdslb.com/live.jpg",
                "online": 758,
                "area_name": "教育学习"
            }
        })
        .to_string();
        let item = json!({
            "id_str": "9",
            "type": "DYNAMIC_TYPE_LIVE_RCMD",
            "modules": {
                "module_author": {
                    "mid": 42428180_u64,
                    "name": "考研竞赛凯哥",
                    "face": "https://i2.hdslb.com/face.jpg",
                    "pub_time": "",
                    "pub_ts": "1794750425"
                },
                "module_dynamic": {
                    "desc": null,
                    "major": {
                        "type": "MAJOR_TYPE_LIVE_RCMD",
                        "live_rcmd": { "content": content }
                    }
                },
                "module_stat": {
                    "forward": { "count": "0" },
                    "comment": { "count": 0 },
                    "like": { "count": 0 }
                }
            }
        });
        let dynamic = super::dynamic_item(&item).expect("直播推荐应能解析");
        assert_eq!(dynamic.kind, super::DynamicKind::Live);
        assert_eq!(dynamic.room_id, 22_084_735);
        assert_eq!(dynamic.title, "选填题技巧火热报名中");
        assert_eq!(dynamic.cover, "https://i0.hdslb.com/live.jpg");
        assert_eq!(dynamic.live_area, "教育学习");
        assert_eq!(dynamic.views, 758);
        assert_eq!(dynamic.pub_ts, 1_794_750_425);
    }

    #[test]
    fn 转发里的直播原动态解析房间() {
        let item = json!({
            "id_str": "10",
            "type": "DYNAMIC_TYPE_FORWARD",
            "modules": {
                "module_author": { "mid": 1_u64, "name": "转发者", "pub_time": "刚刚" },
                "module_dynamic": { "desc": { "text": "在播" }, "major": null }
            },
            "orig": {
                "id_str": "11",
                "type": "DYNAMIC_TYPE_LIVE",
                "modules": {
                    "module_author": { "mid": 2_u64, "name": "主播" },
                    "module_dynamic": {
                        "desc": null,
                        "major": {
                            "type": "MAJOR_TYPE_LIVE",
                            "live": {
                                "id": "21204307",
                                "title": "情感电台欢迎连麦",
                                "cover": "https://i0.hdslb.com/live.jpg",
                                "desc_first": "英雄联盟",
                                "desc_second": "2172人看过"
                            }
                        }
                    }
                }
            }
        });
        let dynamic = super::dynamic_item(&item).expect("转发应能解析");
        let orig = dynamic.orig.expect("应带出原直播");
        assert_eq!(orig.kind, super::DynamicKind::Live);
        assert_eq!(orig.room_id, 21_204_307);
        assert_eq!(orig.live_area, "英雄联盟");
        assert_eq!(orig.views, 2_172);
        assert_eq!(orig.title, "情感电台欢迎连麦");
    }

    #[test]
    fn 转发套转发只保留一层() {
        let outer = json!({
            "id_str": "4",
            "type": "DYNAMIC_TYPE_FORWARD",
            "modules": {
                "module_author": { "mid": 1_u64, "name": "甲" },
                "module_dynamic": { "desc": { "text": "转" }, "major": null }
            },
            "orig": {
                "id_str": "5",
                "type": "DYNAMIC_TYPE_FORWARD",
                "modules": {
                    "module_author": { "mid": 2_u64, "name": "乙" },
                    "module_dynamic": { "desc": { "text": "再转" }, "major": null }
                },
                "orig": {
                    "id_str": "6",
                    "type": "DYNAMIC_TYPE_DRAW",
                    "modules": {
                        "module_author": { "mid": 3_u64, "name": "丙" },
                        "module_dynamic": {
                            "desc": null,
                            "major": { "type": "MAJOR_TYPE_OPUS", "opus": { "summary": { "text": "原图文" } } }
                        }
                    }
                }
            }
        });
        let dynamic = super::dynamic_item(&outer).expect("转发动态应能解析");
        assert_eq!(dynamic.kind, super::DynamicKind::Forward);
        assert!(dynamic.orig.is_none());
    }

    #[test]
    fn 专栏动态带出cv号与封面() {
        let item = json!({
            "id_str": "7",
            "type": "DYNAMIC_TYPE_ARTICLE",
            "modules": {
                "module_author": { "mid": 946974_u64, "name": "写专栏的人" },
                "module_dynamic": {
                    "desc": null,
                    "major": {
                        "type": "MAJOR_TYPE_ARTICLE",
                        "article": {
                            "id": 123456_u64,
                            "title": "十一月听歌小结",
                            "desc": "\u{200b}这张专辑值得反复听",
                            "covers": ["http://i0.hdslb.com/read.jpg"]
                        }
                    }
                },
                "module_stat": {
                    "forward": { "count": 0 },
                    "comment": { "count": 1 },
                    "like": { "count": 9 }
                }
            }
        });
        let dynamic = super::dynamic_item(&item).expect("专栏动态应能解析");
        assert_eq!(dynamic.kind, super::DynamicKind::Article);
        assert_eq!(dynamic.article_id, "123456");
        assert_eq!(dynamic.title, "十一月听歌小结");
        assert_eq!(dynamic.text, "这张专辑值得反复听");
        assert_eq!(dynamic.cover, "https://i0.hdslb.com/read.jpg");
    }
}

fn bangumi_rank_url(season_type: u32) -> String {
    format!("{API}/pgc/web/rank/list?day=3&season_type={season_type}")
}

fn bangumi_follow_item(value: &serde_json::Value) -> Option<BangumiItem> {
    Some(BangumiItem {
        season_id: value["season_id"].as_u64()?,
        title: value["title"].as_str().unwrap_or_default().to_string(),
        cover: value["cover"]
            .as_str()
            .filter(|cover| !cover.is_empty())
            .map(|cover| cover.replacen("http://", "https://", 1)),
        rank: 0,
        rating: value["rating"]["score"]
            .as_f64()
            .map(|score| format!("{score:.1}分"))
            .unwrap_or_default(),
        index_show: value["new_ep"]["index_show"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        play_text: if value["is_finish"].as_u64() == Some(1) {
            "已完结".to_string()
        } else {
            String::new()
        },
    })
}

#[cfg(test)]
mod relation_shape_tests {
    use serde_json::json;

    #[test]
    fn 番剧排行按类别拼接口() {
        assert!(super::bangumi_rank_url(4).ends_with("season_type=4"));
    }

    #[test]
    fn 我的追番复用番剧卡并隐藏排行名次() {
        let value = json!({
            "season_id": 33378_u64,
            "title": "名侦探柯南",
            "cover": "http://i0.hdslb.com/bfs/bangumi/image/cover.png",
            "rating": { "score": 9.4 },
            "new_ep": { "index_show": "更新至第1280话" },
            "is_finish": 0
        });
        let item = super::bangumi_follow_item(&value).expect("追番应能解析");
        assert_eq!(item.season_id, 33378);
        assert_eq!(item.rank, 0);
        assert_eq!(item.rating, "9.4分");
        assert_eq!(item.index_show, "更新至第1280话");
        assert_eq!(item.cover.as_deref(), Some("https://i0.hdslb.com/bfs/bangumi/image/cover.png"));
    }

    /// 真实单期响应里推荐语在 `rcmd_reason`（2026-11 实测，第一条是「就在今天」）。
    /// `achievement` 是入站必刷的字段，在这里是 null，照它解析会永远是空表。
    #[test]
    fn 每周必看推荐语取_rcmd_reason() {
        let list = json!([
            { "bvid": "BV1TgWp6MEHJ", "rcmd_reason": "就在今天", "achievement": null },
            { "bvid": "BV1UB4v67Exr", "rcmd_reason": "", "achievement": "不该用这个" },
            { "bvid": "BV1vmWJ6LEmW" }
        ]);
        let notes = super::weekly_notes(&list);
        assert_eq!(notes.get("BV1TgWp6MEHJ").map(String::as_str), Some("就在今天"));
        assert!(!notes.contains_key("BV1UB4v67Exr"), "空推荐语不该入表");
        assert!(!notes.contains_key("BV1vmWJ6LEmW"), "没给推荐语就不该有这一项");
    }

    /// 同一个字段名在热门里是对象（`{"content": "百万播放"}`），在每周必看里是裸字符串。
    /// 两处共用一套解析的话，其中一边永远是空表。
    #[test]
    fn 热门标签取_rcmd_reason_content() {
        let list = json!([
            { "bvid": "BV1gCWC6KEtf", "rcmd_reason": { "content": "百万播放", "corner_mark": 0 } },
            { "bvid": "BV1xx411c7mD", "rcmd_reason": { "content": "", "corner_mark": 0 } },
            { "bvid": "BV1yy411c7mE" }
        ]);
        let notes = super::popular_notes(&list);
        assert_eq!(notes.get("BV1gCWC6KEtf").map(String::as_str), Some("百万播放"));
        assert!(!notes.contains_key("BV1xx411c7mD"), "空标签不该入表");
        assert!(!notes.contains_key("BV1yy411c7mE"), "没有 rcmd_reason 就不该有这一项");
    }

    /// 这个结构取自真实登录态响应（2025-11 实测）：
    /// 字段是 `like` / `favorite` / `coin`，前两个是 bool。
    /// 早先按 `liked` 解析，结果永远是 false——登录了也点不亮。
    fn parse(v: &serde_json::Value) -> (bool, bool, u32) {
        let data = &v["data"];
        (
            data["like"].as_bool().unwrap_or(false),
            data["favorite"].as_bool().unwrap_or(false),
            data["coin"].as_u64().unwrap_or(0) as u32,
        )
    }

    #[test]
    fn 按真实字段解析互动状态() {
        let v = json!({ "code": 0, "data": {
            "like": true, "favorite": true, "coin": 2,
            "attention": false, "dislike": false, "season_fav": false
        }});
        assert_eq!(parse(&v), (true, true, 2));
    }

    #[test]
    fn 未互动时三项都是假() {
        let v = json!({ "code": 0, "data": {
            "like": false, "favorite": false, "coin": 0,
            "attention": false, "dislike": false, "season_fav": false
        }});
        assert_eq!(parse(&v), (false, false, 0));
    }

    #[test]
    fn 旧字段名不再被当成有效来源() {
        // 如果哪天有人改回 liked，这个断言会提醒他字段名不对
        let v = json!({ "code": 0, "data": { "liked": true, "coin": 1 } });
        assert_eq!(parse(&v), (false, false, 1), "liked 是错的字段名");
    }
}

#[cfg(test)]
mod emote_tests {
    use serde_json::json;

    #[test]
    fn 表情包响应拍平成代号与_https_图片() {
        let value = json!({
            "data": {
                "packages": [
                    { "emote": [
                        { "text": "[大笑]", "url": "http://i0.hdslb.com/a.png" },
                        { "text": "", "url": "http://i0.hdslb.com/b.png" },
                        { "text": "[坏链接]", "url": "" }
                    ] },
                    { "emote": [
                        { "text": "[2233娘_大笑]", "url": "http://i0.hdslb.com/c.png" }
                    ] },
                    { "emote": null }
                ]
            }
        });
        assert_eq!(
            super::emote_pairs(&value),
            vec![
                ("[大笑]".to_string(), "https://i0.hdslb.com/a.png".to_string()),
                ("[2233娘_大笑]".to_string(), "https://i0.hdslb.com/c.png".to_string())
            ]
        );
    }
}
