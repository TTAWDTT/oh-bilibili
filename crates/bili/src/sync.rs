//! 喜欢与收藏。
//!
//! 喜欢映射成 B 站点赞；收藏映射到固定名字的收藏夹，没有就自动建。
//! 两个接口都要 csrf（bili_jct），也必须登录。

use crate::client::{Client, API};
use crate::error::BiliError;

/// 收藏夹名。产品要求固定这个名字，用户 B 站里能看到同一个夹子。
pub const DEFAULT_FOLDER: &str = "哔哩哔哩 music";

impl Client {
    /// 点赞 / 取消点赞。
    pub async fn like_video(&self, aid: u64, on: bool) -> Result<(), BiliError> {
        let csrf = self
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("没有 bili_jct".into()))?;
        let body = vec![
            ("aid", aid.to_string()),
            ("like", if on { "1" } else { "0" }.to_string()),
            ("csrf", csrf),
        ];
        self.post_form(&format!("{API}/x/web-interface/archive/like"), body)
            .await?;
        Ok(())
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

    /// 某个收藏夹里的视频 bvid 列表。
    pub async fn fav_items(&self, folder_id: i64) -> Result<Vec<String>, BiliError> {
        let v = self
            .get_json(
                &format!(
                    "{API}/x/v3/fav/resource/list?media_id={folder_id}&ps=40&pn=1&platform=web"
                ),
                std::time::Duration::from_millis(400),
            )
            .await?;
        let Some(list) = v["data"]["medias"].as_array() else {
            return Ok(Vec::new());
        };
        Ok(list
            .iter()
            .filter_map(|m| m["bvid"].as_str().map(|s| s.to_string()))
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
