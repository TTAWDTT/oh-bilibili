use super::{media_url, number};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectCard {
    pub title: String,
    pub cover: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
}

fn text(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn video_url(bvid: &Value, aid: Option<u64>) -> Option<String> {
    if let Some(id) = bvid.as_str().filter(|s| {
        s.starts_with("BV") && s.len() == 12 && s.bytes().all(|b| b.is_ascii_alphanumeric())
    }) {
        Some(format!("https://www.bilibili.com/video/{id}"))
    } else {
        aid.map(|id| format!("https://www.bilibili.com/video/av{id}"))
    }
}

fn share_url(data: &Value) -> Option<String> {
    let id = number(&data["id"]).filter(|id| *id > 0);
    Some(match number(&data["source"])? {
        1 => format!("https://vc.bilibili.com/video/{}", id?),
        2 => format!("https://t.bilibili.com/{}?type=2", id?),
        4 => format!("https://live.bilibili.com/{}", id?),
        5 | 9 => return video_url(&data["bvid"], id),
        6 => format!("https://www.bilibili.com/read/cv{}", id?),
        7 => format!("https://bangumi.bilibili.com/anime/{}", id?),
        11 => format!("https://t.bilibili.com/{}?tab=1", id?),
        16 => return media_url(&data["url"]),
        _ => return None,
    })
}

pub(super) fn received_cards(kind: u64, data: &Value, sender: u64) -> Vec<DirectCard> {
    if kind == 16 {
        return data["sub_cards"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                make_card(
                    text(&item["field1"]),
                    "自动回复",
                    media_url(&item["cover_url"]),
                    media_url(&item["jump_url"]),
                    text(&item["field2"]),
                    None,
                )
            })
            .collect();
    }
    let title = text(&data["title"]);
    let card = match kind {
        7 => make_card(
            title,
            "分享",
            media_url(&data["thumb"]),
            share_url(data),
            text(&data["headline"]),
            text(&data["author"]),
        ),
        10 => {
            let biz = &data["biz_content"];
            let appointment = sender == 844424930131957;
            let cover = if appointment {
                media_url(&biz["cover"]).or_else(|| media_url(&biz["backup_cover"]))
            } else {
                None
            };
            let mut cards: Vec<_> = make_card(
                title,
                if appointment {
                    "预约提醒"
                } else {
                    "通知"
                },
                cover,
                media_url(&data["jump_uri"]),
                text(&data["text"]),
                text(&data["notifier"]["nickname"]),
            )
            .into_iter()
            .collect();
            for (url, label) in [("jump_uri_2", "jump_text_2"), ("jump_uri_3", "jump_text_3")] {
                if let Some(target) = media_url(&data[url]) {
                    cards.push(DirectCard {
                        title: text(&data[label]).unwrap_or_else(|| "查看详情".into()),
                        cover: None,
                        url: Some(target),
                        description: None,
                        author: None,
                    });
                }
            }
            return cards;
        }
        11 => make_card(
            title,
            "视频",
            media_url(&data["cover"]),
            video_url(&data["bvid"], None),
            None,
            None,
        ),
        12 => make_card(
            title,
            "文章",
            media_url(&data["image_urls"][0]),
            number(&data["rid"])
                .filter(|id| *id > 0)
                .map(|id| format!("https://www.bilibili.com/read/cv{id}")),
            None,
            None,
        ),
        13 => make_card(
            title,
            "图卡",
            media_url(&data["pic_url"]),
            media_url(&data["jump_url"]),
            None,
            None,
        ),
        14 => make_card(
            title,
            "分享",
            media_url(&data["cover"]),
            media_url(&data["url"]),
            text(&data["desc"]),
            text(&data["author"]),
        ),
        _ => None,
    };
    card.into_iter().collect()
}

fn make_card(
    title: Option<String>,
    fallback: &str,
    cover: Option<String>,
    url: Option<String>,
    description: Option<String>,
    author: Option<String>,
) -> Option<DirectCard> {
    if title.is_none() && cover.is_none() && url.is_none() && description.is_none() {
        return None;
    }
    Some(DirectCard {
        title: title.unwrap_or_else(|| fallback.into()),
        cover,
        url,
        description,
        author,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::direct::{history_from, message_content};
    use serde_json::json;

    #[test]
    fn supported_cards_use_their_official_fields() {
        let samples = [
            (
                7,
                json!({"title":"投稿","source":5,"id":"12","thumb":"//i0.hdslb.com/cover.jpg","author":"up"}),
                "https://www.bilibili.com/video/av12",
            ),
            (
                11,
                json!({"title":"投稿","bvid":"BV1xx411c7mD","cover":"//i0.hdslb.com/cover.jpg"}),
                "https://www.bilibili.com/video/BV1xx411c7mD",
            ),
            (
                12,
                json!({"title":"文章","rid":"123","image_urls":["//i0.hdslb.com/cover.jpg"]}),
                "https://www.bilibili.com/read/cv123",
            ),
            (
                13,
                json!({"title":"图卡","pic_url":"//i0.hdslb.com/cover.jpg","jump_url":"https://www.bilibili.com/"}),
                "https://www.bilibili.com/",
            ),
            (
                14,
                json!({"title":"分享","cover":"//i0.hdslb.com/cover.jpg","url":"https://www.bilibili.com/","desc":"简介","author":"up"}),
                "https://www.bilibili.com/",
            ),
            (
                16,
                json!({"reply_content":"正文","sub_cards":[{"field1":"作品","field2":"说明","cover_url":"//i0.hdslb.com/cover.jpg","jump_url":"https://www.bilibili.com/"}]}),
                "https://www.bilibili.com/",
            ),
            (
                10,
                json!({"title":"预约","biz_content":{"backup_cover":"//i0.hdslb.com/cover.jpg"},"jump_uri":"https://www.bilibili.com/"}),
                "https://www.bilibili.com/",
            ),
        ];
        for (kind, body, url) in samples {
            let cards = received_cards(kind, &body, 844424930131957);
            assert_eq!(cards.len(), 1);
            assert_eq!(cards[0].url.as_deref(), Some(url));
            assert_eq!(
                cards[0].cover.as_deref(),
                Some("https://i0.hdslb.com/cover.jpg")
            );
        }
        let bad = received_cards(14, &json!({"title":"保留标题","url":"javascript:bad()"}), 4);
        assert!(bad[0].url.is_none());
    }

    #[test]
    fn history_preserves_attached_text_and_withdraws_the_whole_card() {
        let mut msg = json!({"sender_uid":4,"receiver_id":2,"receiver_type":1,"msg_type":12,"msg_key":"1234","msg_seqno":"20",
            "content":json!({"rid":10,"title":"标题","attach_msg":{"content":"看这篇[doge]"}}).to_string()});
        assert_eq!(message_content(&msg).0, "[文章]标题");
        let history = |m: &Value| {
            history_from(&json!({"messages":[m], "e_infos":[{"text":"[doge]","url":"https://i0.hdslb.com/emoji.png"}]}), 2, 4, None)
                .unwrap()
                .items
                .remove(0)
        };
        let visible = history(&msg);
        assert_eq!(visible.text, "看这篇[doge]");
        assert_eq!(visible.cards[0].title, "标题");
        assert_eq!(
            visible.emotes,
            vec![("[doge]".into(), "https://i0.hdslb.com/emoji.png".into())]
        );
        msg["msg_status"] = json!(1);
        let removed = history(&msg);
        assert_eq!(removed.text, "消息已撤回");
        assert!(removed.cards.is_empty() && removed.emotes.is_empty() && removed.image.is_none());
    }
}
