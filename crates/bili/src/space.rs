//! UP 主公开设置的置顶投稿、代表作与合集/系列。

use crate::{client::API, error::BiliError, sync::track_from_item, Source};
use bilimusic_model::Track;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpacePick {
    Pinned,
    Masterpieces,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectionKind {
    Season,
    Series,
}

#[derive(Serialize)]
pub struct SpaceCollection {
    pub kind: CollectionKind,
    pub id: u64,
    pub name: String,
    pub cover: Option<String>,
    pub total: u64,
}

impl Source {
    pub async fn space_picks(&self, mid: u64, kind: SpacePick) -> Result<Vec<Track>, BiliError> {
        let path = match kind {
            SpacePick::Pinned => "top/arc",
            SpacePick::Masterpieces => "masterpiece",
        };
        let response = self
            .client
            .get_json_allowing_guest(
                &format!("{API}/x/space/{path}?vmid={mid}"),
                Duration::from_millis(400),
            )
            .await?;
        let data = &response["data"];
        Ok(match kind {
            SpacePick::Pinned => track_from_item(data).into_iter().collect(),
            SpacePick::Masterpieces => data
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(track_from_item)
                .collect(),
        })
    }

    pub async fn space_collections(
        &self,
        mid: u64,
        page: u32,
    ) -> Result<(Vec<SpaceCollection>, u64), BiliError> {
        let response = self.client.get_json_allowing_guest(
            &format!("{API}/x/polymer/web-space/seasons_series_list?mid={mid}&page_num={page}&page_size=12"),
            Duration::from_millis(400),
        ).await?;
        let data = &response["data"]["items_lists"];
        let total = data["page"]["total"]
            .as_u64()
            .ok_or_else(|| BiliError::Parse("缺少空间合集目录".into()))?;
        let mut collections = Vec::new();
        for (field, id_field, kind) in [
            ("seasons_list", "season_id", CollectionKind::Season),
            ("series_list", "series_id", CollectionKind::Series),
        ] {
            collections.extend(
                data[field]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|entry| {
                        let meta = &entry["meta"];
                        let cover = meta["cover"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .or_else(|| entry["archives"][0]["pic"].as_str());
                        Some(SpaceCollection {
                            id: meta[id_field].as_u64()?,
                            kind,
                            name: meta["name"].as_str()?.to_owned(),
                            cover: cover.map(|s| s.replacen("http://", "https://", 1)),
                            total: meta["total"].as_u64()?,
                        })
                    }),
            );
        }
        Ok((collections, total))
    }

    pub async fn space_collection_works(
        &self,
        mid: u64,
        kind: CollectionKind,
        id: u64,
        page: u32,
    ) -> Result<(Vec<Track>, u64), BiliError> {
        let path = match kind {
            CollectionKind::Season => format!("/x/polymer/web-space/seasons_archives_list?mid={mid}&season_id={id}&page_num={page}&page_size=30"),
            CollectionKind::Series => format!("/x/series/archives?mid={mid}&series_id={id}&pn={page}&ps=30"),
        };
        let response = self
            .client
            .get_json_allowing_guest(&format!("{API}{path}"), Duration::from_millis(400))
            .await?;
        let data = &response["data"];
        let total = data["page"]["total"]
            .as_u64()
            .ok_or_else(|| BiliError::Parse("缺少合集作品目录".into()))?;
        let works = data["archives"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(track_from_item)
            .collect();
        Ok((works, total))
    }
}
