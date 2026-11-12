//! 喜欢与收藏。
//!
//! 喜欢映射成 B 站点赞；收藏映射到固定名字的收藏夹，没有就自动建。
//! 两个接口都要 csrf（bili_jct），也必须登录。

use crate::client::{Client, API};
use crate::error::BiliError;

/// 收藏夹名。产品要求固定这个名字，用户 B 站里能看到同一个夹子。
pub const DEFAULT_FOLDER: &str = "哔哩哔哩 music";

/// UP 主名片。
#[derive(Debug, Clone)]
pub struct AuthorCard {
    pub name: String,
    pub face: String,
    pub fans: u64,
    pub sign: String,
    pub official: Option<String>,
    /// 用户等级 0..6。就在 card 接口里，不用另调 acc/info（那条会被限流成 -799）。
    pub level: u8,
    /// 投稿总数。
    pub videos: u64,
    /// 累计获赞。
    pub likes: u64,
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
    pub async fn send_danmaku(
        &self,
        cid: u64,
        bvid: &str,
        text: &str,
        progress_ms: u64,
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
            ("mode", "1".to_string()),
            ("fontsize", "25".to_string()),
            ("color", "16777215".to_string()),
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
            official: card["Official"]["title"].as_str().map(|s| s.to_string()),
            // 等级就在 card 里，不需要另调 acc/info（那条会被限流成 -799）。
            level: card["level_info"]["current_level"].as_u64().unwrap_or(0) as u8,
            videos: v["data"]["archive_count"].as_u64().unwrap_or(0),
            likes: v["data"]["like_num"].as_u64().unwrap_or(0),
        })
    }

    /// 当前账号的收藏夹列表。返回 (media_id, 名字, 条目数)。
    pub async fn fav_folders(&self) -> Result<Vec<(i64, String, u32)>, BiliError> {
        let mid = self
            .logged_in_mid()
            .ok_or_else(|| BiliError::NeedsLogin("还没有登录".into()))?;
        let v = self
            .get_json(
                &format!("{API}/x/v3/fav/folder/created/list-all?up_mid={mid}&rid=0"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let Some(list) = v["data"]["list"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list
            .iter()
            .filter_map(|item| {
                Some((
                    item["id"].as_i64()?,
                    item["title"].as_str()?.to_string(),
                    item["media_count"].as_u64().unwrap_or(0) as u32,
                ))
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
    ) -> Result<Vec<serde_json::Value>, BiliError> {
        let v = self
            .get_json(
                &format!(
                    "{API}/x/v3/fav/resource/list?media_id={folder_id}&ps={ps}&pn={}&platform=web",
                    page.max(1)
                ),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(v["data"]["medias"].as_array().cloned().unwrap_or_default())
    }

    /// 收藏夹列表用的封面拼图：取每个夹子最前面的几张封面。
    pub async fn fav_covers(&self, folder_id: i64, limit: u32) -> Result<Vec<String>, BiliError> {
        Ok(self
            .fav_medias(folder_id, 1, limit.clamp(1, 20))
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
            .fav_medias(folder_id, page, 40)
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
    pub async fn space_videos(
        &self,
        mid: u64,
        page: u32,
    ) -> Result<(Vec<bilimusic_model::Track>, u32), BiliError> {
        use bilimusic_model::{Millis, Track, TrackKey};

        let v = self
            .signed_get(
                &format!("{API}/x/space/wbi/arc/search"),
                vec![
                    ("mid", mid.to_string()),
                    ("pn", page.max(1).to_string()),
                    ("ps", "30".to_string()),
                    ("order", "pubdate".to_string()),
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
            .get_json(
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
                &format!(
                    "{API}/x/relation/followings?vmid={mid}&pn={}&ps=20&order=desc",
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
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((list, total))
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

    /// 评论表情面板。取第一包「小黄脸」，颜文字没有图片，跳过。
    pub async fn comment_emotes(&self) -> Result<Vec<(String, String)>, BiliError> {
        let v = self
            .get_json(
                &format!("{API}/x/emote/user/panel/web?business=reply"),
                std::time::Duration::from_millis(300),
            )
            .await?;
        let Some(pkg) = v["data"]["packages"].as_array().and_then(|list| list.first()) else {
            return Ok(Vec::new());
        };
        let Some(list) = pkg["emote"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list
            .iter()
            .filter_map(|e| {
                let code = e["text"].as_str()?.to_string();
                let url = e["url"].as_str().filter(|u| u.starts_with("http"))?;
                Some((code, url.to_string()))
            })
            .collect())
    }

    /// 排行榜。公开接口，一次返回 100 条；rid=0 是全站。
    pub async fn ranking(&self, rid: u32) -> Result<Vec<bilimusic_model::Track>, BiliError> {
        use bilimusic_model::{Millis, Track, TrackKey};

        let v = self
            .get_json(
                &format!("{API}/x/web-interface/ranking/v2?rid={rid}&type=all"),
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

#[cfg(test)]
mod relation_shape_tests {
    use serde_json::json;

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
