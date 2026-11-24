//! 作者空间的公开作品、收藏与兴趣目录。

use crate::{client::API, error::BiliError, sync::track_from_item, Source};
use bilimusic_model::Track;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const SIZE: u64 = 12;
const INTERVAL: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Catalog {
    Opus,
    Articles,
    ReadingLists,
    ReadingList { id: u64 },
    Audio,
    Courses,
    Reservations,
    Coins,
    Likes,
    Created,
    Collected,
    Folder { id: u64 },
    SubscribedSeason { id: u64, owner: u64 },
    Anime,
    Cinema,
    Tags,
    Games,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Destination {
    Web { url: String },
    ReadingList { id: u64 },
    Folder { id: u64 },
    SubscribedSeason { id: u64, owner: u64 },
    Video { track: Track },
    Search { keyword: String },
    Reservation { mid: u64, starts_at: Option<u64> },
    Unavailable,
}

#[derive(Serialize)]
pub struct CatalogItem {
    pub title: String,
    pub cover: Option<String>,
    pub detail: Option<String>,
    pub destination: Destination,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CatalogPage {
    Private,
    Public {
        items: Vec<CatalogItem>,
        more: bool,
        offset: Option<String>,
    },
}

impl Source {
    async fn catalog_settings(&self, mid: u64) -> Result<Value, BiliError> {
        self.client
            .get_json(&format!("{API}/x/space/setting?mid={mid}"), INTERVAL)
            .await
    }

    pub async fn space_catalog_order(&self, mid: u64) -> Result<Vec<u64>, BiliError> {
        let response = self.catalog_settings(mid).await?;
        let order = response["data"]["index_order"]
            .as_array()
            .ok_or_else(|| BiliError::Parse("缺少空间栏目顺序".into()))?;
        Ok(order
            .iter()
            .filter_map(|entry| entry["id"].as_u64())
            .collect())
    }

    pub async fn space_catalog(
        &self,
        mid: u64,
        catalog: Catalog,
        page: u32,
        offset: Option<&str>,
    ) -> Result<CatalogPage, BiliError> {
        if let Some(setting) = catalog.privacy_setting() {
            let settings = self.catalog_settings(mid).await?;
            match settings["data"]["privacy"][setting].as_u64() {
                Some(0) => return Ok(CatalogPage::Private),
                Some(1) => {}
                _ => return Err(BiliError::Parse(format!("缺少空间公开设置 {setting}"))),
            }
        }
        let page = u64::from(page.max(1));
        let url = catalog.url(mid, page, offset)?;
        match self.client.get_json(&url, INTERVAL).await {
            Ok(response) => catalog.decode(&response["data"], page),
            Err(BiliError::Api { code: 53013, .. }) => Ok(CatalogPage::Private),
            Err(error) => Err(error),
        }
    }
}

impl Catalog {
    fn privacy_setting(self) -> Option<&'static str> {
        match self {
            Self::Created
            | Self::Collected
            | Self::Folder { .. }
            | Self::SubscribedSeason { .. } => Some("fav_video"),
            Self::Anime | Self::Cinema => Some("bangumi"),
            Self::Coins => Some("coins_video"),
            Self::Likes => Some("likes_video"),
            Self::Tags => Some("tags"),
            Self::Games => Some("played_game"),
            Self::Courses => Some("lesson_video"),
            _ => None,
        }
    }

    fn url(self, mid: u64, page: u64, offset: Option<&str>) -> Result<String, BiliError> {
        let path = match self {
            Self::Opus => {
                let mut url = reqwest::Url::parse(&format!("{API}/x/polymer/web-dynamic/v1/opus/feed/space?host_mid={mid}"))
                    .map_err(|e| BiliError::Parse(e.to_string()))?;
                if let Some(offset) = offset { url.query_pairs_mut().append_pair("offset", offset); }
                return Ok(url.to_string());
            }
            Self::Articles => format!("/x/space/article?mid={mid}&pn={page}&ps={SIZE}&sort=publish_time"),
            Self::ReadingLists => format!("/x/article/up/lists?mid={mid}"),
            Self::ReadingList { id } => format!("/x/article/list/web/articles?id={id}"),
            Self::Audio => return Ok(format!("https://www.bilibili.com/audio/music-service/web/song/upper?uid={mid}&pn={page}&ps={SIZE}&order=1")),
            Self::Coins => format!("/x/space/coin/video?vmid={mid}"),
            Self::Likes => format!("/x/space/like/video?vmid={mid}"),
            Self::Reservations => format!("/x/space/reservation?vmid={mid}"),
            Self::Courses => format!("/pugv/app/web/season/page?mid={mid}&pn={page}&ps={SIZE}"),
            Self::Created | Self::Collected => {
                let folder = if matches!(self, Self::Created) { "created" } else { "collected" };
                format!("/x/v3/fav/folder/{folder}/list?up_mid={mid}&pn={page}&ps={SIZE}&platform=web")
            }
            Self::SubscribedSeason { id, owner } => format!("/x/polymer/web-space/seasons_archives_list?mid={owner}&season_id={id}&page_num={page}&page_size={SIZE}"),
            Self::Folder { id } => format!("/x/v3/fav/resource/list?media_id={id}&pn={page}&ps={SIZE}&platform=web"),
            Self::Anime | Self::Cinema => {
                let kind = if matches!(self, Self::Anime) { 1 } else { 2 };
                format!("/x/space/bangumi/follow/list?vmid={mid}&type={kind}&pn={page}&ps={SIZE}")
            }
            Self::Tags => format!("/x/space/tag/sub/list?vmid={mid}&pn={page}&ps={SIZE}"),
            Self::Games => format!("/x/space/lastplaygame/v2?mid={mid}&page_num={page}&page_size={SIZE}"),
        };
        Ok(format!("{API}{path}"))
    }

    fn decode(self, data: &Value, page: u64) -> Result<CatalogPage, BiliError> {
        let (field, more) = match self {
            Self::Opus => ("items", data["has_more"].as_bool()),
            Self::Coins | Self::Reservations => ("", Some(false)),
            Self::Likes => ("list", Some(false)),
            Self::Courses => ("items", data["page"]["next"].as_bool()),
            Self::Articles => ("articles", more_by_total(data, "count", page)),
            Self::ReadingLists => ("lists", Some(false)),
            Self::ReadingList { .. } => ("articles", Some(false)),
            Self::Audio => ("data", data["pageCount"].as_u64().map(|last| page < last)),
            Self::Created | Self::Collected => ("list", data["has_more"].as_bool()),
            Self::SubscribedSeason { .. } => {
                ("archives", more_by_total(&data["page"], "total", page))
            }
            Self::Folder { .. } => ("medias", data["has_more"].as_bool()),
            Self::Anime | Self::Cinema => ("list", more_by_total(data, "total", page)),
            Self::Tags => ("tags", more_by_total(data, "total", page)),
            Self::Games => ("list", more_by_total(data, "total_count", page)),
        };
        let mut more = more.ok_or_else(|| BiliError::Parse("缺少空间目录页码".into()))?;
        let list = if matches!(self, Self::Reservations | Self::Coins) {
            Some(data)
        } else {
            data.get(field)
        };
        let rows = match list {
            Some(Value::Array(rows)) => rows.as_slice(),
            Some(Value::Null) if !more => &[],
            _ => return Err(BiliError::Parse(format!("缺少空间目录 {field}"))),
        };
        // 文集、预约与最近互动接口一次返回完整目录，不接受页码。
        let rows = if matches!(
            self,
            Self::ReadingLists
                | Self::ReadingList { .. }
                | Self::Reservations
                | Self::Coins
                | Self::Likes
        ) {
            let start = ((page - 1) * SIZE).min(rows.len() as u64) as usize;
            let end = (start + SIZE as usize).min(rows.len());
            more = end < rows.len();
            &rows[start..end]
        } else {
            rows
        };
        let offset = if matches!(self, Self::Opus) && more {
            Some(
                string(&data["offset"])
                    .ok_or_else(|| BiliError::Parse("缺少下一页图文位置".into()))?,
            )
        } else {
            None
        };
        let items = rows.iter().filter_map(|item| self.item(item)).collect();
        Ok(CatalogPage::Public {
            items,
            more,
            offset,
        })
    }

    fn item(self, v: &Value) -> Option<CatalogItem> {
        use Destination::*;
        let web = |url| Web { url };
        let (title, cover, detail, destination) = match self {
            Self::Opus => {
                let title = string(&v["title"])
                    .or_else(|| {
                        v["content"]
                            .as_str()?
                            .lines()
                            .find(|s| !s.trim().is_empty())
                            .map(|s| s.chars().take(100).collect())
                    })
                    .unwrap_or_else(|| "图文动态".into());
                let id = v["opus_id"].as_str()?;
                (
                    title,
                    &v["cover"]["url"],
                    None,
                    web(format!("https://www.bilibili.com/opus/{id}")),
                )
            }
            Self::Articles | Self::ReadingList { .. } => (
                string(&v["title"])?,
                &v["image_urls"][0],
                string(&v["category"]["name"]),
                web(format!(
                    "https://www.bilibili.com/read/cv{}",
                    v["id"].as_u64()?
                )),
            ),
            Self::ReadingLists => (
                string(&v["name"])?,
                &v["image_url"],
                v["articles_count"].as_u64().map(|n| format!("{n} 篇文章")),
                ReadingList {
                    id: v["id"].as_u64()?,
                },
            ),
            Self::Audio => (
                string(&v["title"])?,
                &v["cover"],
                string(&v["author"]),
                web(format!(
                    "https://www.bilibili.com/audio/au{}",
                    v["id"].as_u64()?
                )),
            ),
            Self::Courses => (
                string(&v["title"])?,
                &v["cover"],
                string(&v["status"]),
                web(format!(
                    "https://www.bilibili.com/cheese/play/ss{}",
                    v["season_id"].as_u64()?
                )),
            ),
            Self::Created | Self::Collected => {
                // 收藏夹 attr 的最低位表示私密。自己查看空间时，站方也可能返回私密夹。
                if v["attr"].as_u64().is_some_and(|attr| attr & 1 != 0) {
                    return None;
                }
                let id = v["id"].as_u64()?;
                let action = if matches!(self, Self::Collected) && v["type"].as_u64() == Some(21) {
                    SubscribedSeason {
                        id,
                        owner: v["upper"]["mid"].as_u64()?,
                    }
                } else {
                    Folder { id }
                };
                (
                    string(&v["title"])?,
                    &v["cover"],
                    v["media_count"].as_u64().map(|n| format!("{n} 个作品")),
                    action,
                )
            }
            Self::Folder { .. } => {
                let gone = v["attr"].as_u64().is_some_and(|attr| attr & 1 != 0);
                let action = match v["type"].as_u64() {
                    _ if gone => Unavailable,
                    Some(2) => {
                        let mut track = track_from_item(v)?;
                        track.artist = v["upper"]["name"].as_str().unwrap_or_default().into();
                        track.up_mid = v["upper"]["mid"].as_u64();
                        Video { track }
                    }
                    Some(12) => web(format!(
                        "https://www.bilibili.com/audio/au{}",
                        v["id"].as_u64()?
                    )),
                    _ => string(&v["link"])
                        .filter(|s| s.starts_with("https://"))
                        .map_or(Unavailable, web),
                };
                let detail = if gone {
                    Some("已失效".into())
                } else {
                    string(&v["upper"]["name"])
                };
                (string(&v["title"])?, &v["cover"], detail, action)
            }
            Self::Anime | Self::Cinema => (
                string(&v["title"])?,
                &v["cover"],
                string(&v["new_ep"]["index_show"]),
                web(format!(
                    "https://www.bilibili.com/bangumi/play/ss{}",
                    v["season_id"].as_u64()?
                )),
            ),
            Self::Tags => {
                let title = string(&v["tag_name"])?;
                (title.clone(), &v["cover"], None, Search { keyword: title })
            }
            Self::Coins | Self::Likes | Self::SubscribedSeason { .. } => {
                let track = track_from_item(v)?;
                (
                    track.title.clone(),
                    &v["pic"],
                    string(&v["owner"]["name"]),
                    Video { track },
                )
            }
            Self::Reservations => {
                let count = v["show_total"]
                    .as_bool()
                    .filter(|&show| show)
                    .and_then(|_| v["total"].as_u64())
                    .map(|n| format!("{n} 人预约"));
                (
                    string(&v["name"])?,
                    &Value::Null,
                    count,
                    Reservation {
                        mid: v["up_mid"].as_u64()?,
                        starts_at: v["live_plan_start_time"].as_u64().filter(|&t| t > 0),
                    },
                )
            }
            Self::Games => (
                string(&v["game_name"])?,
                &v["game_icon"],
                string(&v["game_tags"][0]),
                web(string(&v["detail_url"])?),
            ),
        };
        let cover = string(cover).map(|url| {
            if url.starts_with("//") {
                format!("https:{url}")
            } else {
                url.replacen("http://", "https://", 1)
            }
        });
        Some(CatalogItem {
            title,
            cover,
            detail,
            destination,
        })
    }
}

fn string(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned)
}

fn more_by_total(data: &Value, key: &str, page: u64) -> Option<bool> {
    let size = data["ps"]
        .as_u64()
        .or_else(|| data["page_size"].as_u64())
        .unwrap_or(SIZE);
    data[key].as_u64().map(|total| page * size < total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn invalid_favorites_keep_their_place_and_next_page() {
        let data = json!({"has_more": true, "medias": [
            {"title": "已失效视频", "type": 2, "attr": 1, "bvid": "BV123"},
            {"title": "失效视频", "type": 2, "attr": 9}
        ]});
        let CatalogPage::Public { items, more, .. } =
            (Catalog::Folder { id: 1 }).decode(&data, 1).unwrap()
        else {
            panic!("公开夹应返回目录")
        };
        assert!(more);
        assert_eq!(items.len(), 2);
        assert!(items
            .iter()
            .all(|entry| matches!(entry.destination, Destination::Unavailable)));
    }

    #[test]
    fn missing_pagination_is_an_error_and_empty_reservations_are_valid() {
        assert!(Catalog::Opus.decode(&json!({"items": []}), 1).is_err());
        assert!(
            matches!(Catalog::Reservations.decode(&Value::Null, 1).unwrap(), CatalogPage::Public { items, more: false, .. } if items.is_empty())
        );
    }
}
