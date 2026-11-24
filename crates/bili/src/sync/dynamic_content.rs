use super::dynamic_mid;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DynamicNode {
    Text { text: String },
    Emoji { text: String, image: String },
    Mention { text: String, mid: u64 },
    Link { text: String, url: String },
    Video { text: String, bvid: String },
    Topic { text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DynamicAttachment {
    pub label: String,
    pub title: String,
    pub detail: String,
    pub cover: Option<String>,
    pub url: String,
    pub ends_at: Option<u64>,
}

fn dynamic_web_url(value: &Value) -> Option<String> {
    let raw = value.as_str()?;
    let absolute = if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_owned()
    };
    let url = reqwest::Url::parse(&absolute).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(
        if url.scheme() == "http"
            && matches!(url.domain(), Some(domain) if domain == "bilibili.com" || domain.ends_with(".bilibili.com") || domain.ends_with(".hdslb.com") || domain.ends_with(".biliimg.com"))
        {
            absolute.replacen("http:", "https:", 1)
        } else {
            absolute
        },
    )
}

pub(super) fn dynamic_nodes(value: &Value, discussion: &str) -> Vec<DynamicNode> {
    let Some(nodes) = value.as_array() else {
        return Vec::new();
    };
    nodes
        .iter()
        .filter_map(|node| {
            let text = node["text"].as_str()?.to_owned();
            let kind = node["type"].as_str().unwrap_or_default();
            match kind {
                "RICH_TEXT_NODE_TYPE_EMOJI" => {
                    if let Some(image) = dynamic_web_url(&node["emoji"]["icon_url"]) {
                        return Some(DynamicNode::Emoji { text, image });
                    }
                }
                "RICH_TEXT_NODE_TYPE_AT" => {
                    if let Some(mid) = dynamic_mid(&node["rid"]).filter(|n| *n > 0) {
                        return Some(DynamicNode::Mention { text, mid });
                    }
                }
                "RICH_TEXT_NODE_TYPE_BV" => {
                    if let Some(bvid) = node["rid"].as_str().filter(|s| s.starts_with("BV")) {
                        return Some(DynamicNode::Video {
                            text,
                            bvid: bvid.into(),
                        });
                    }
                }
                "RICH_TEXT_NODE_TYPE_TOPIC" => return Some(DynamicNode::Topic { text }),
                "RICH_TEXT_NODE_TYPE_LOTTERY" | "RICH_TEXT_NODE_TYPE_VOTE" => {
                    return Some(DynamicNode::Link {
                        text,
                        url: dynamic_web_url(&node["jump_url"])
                            .unwrap_or_else(|| discussion.to_owned()),
                    })
                }
                _ => {}
            }
            Some(match dynamic_web_url(&node["jump_url"]) {
                Some(url) => DynamicNode::Link { text, url },
                None => DynamicNode::Text { text },
            })
        })
        .collect()
}

pub(super) fn dynamic_attachment(value: &Value, discussion: &str) -> Option<DynamicAttachment> {
    let card_type = value["type"].as_str()?;
    let (label, card, details) = match card_type {
        "ADDITIONAL_TYPE_VOTE" => ("投票", &value["vote"], vec![&value["vote"]["desc"]]),
        "ADDITIONAL_TYPE_RESERVE" => {
            let card = &value["reserve"];
            let mut details = vec![&card["desc1"]["text"], &card["desc2"]["text"]];
            if card["button"]["uncheck"]["disable"] == 1 {
                details.push(&card["button"]["uncheck"]["text"]);
            }
            ("预约", card, details)
        }
        "ADDITIONAL_TYPE_COMMON" => {
            let card = &value["common"];
            (
                card["head_text"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("相关内容"),
                card,
                vec![&card["desc1"], &card["desc2"]],
            )
        }
        "ADDITIONAL_TYPE_NONE" | "" => return None,
        _ => {
            return Some(DynamicAttachment {
                label: "附加内容".into(),
                title: "在 B 站查看原动态".into(),
                detail: String::new(),
                cover: None,
                url: discussion.into(),
                ends_at: None,
            })
        }
    };
    Some(DynamicAttachment {
        label: label.into(),
        title: card["title"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("在 B 站查看原动态")
            .into(),
        detail: details
            .into_iter()
            .filter_map(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · "),
        cover: dynamic_web_url(&card["cover"]),
        url: dynamic_web_url(&card["jump_url"])
            .or_else(|| dynamic_web_url(&card["button"]["jump_url"]))
            .unwrap_or_else(|| discussion.to_owned()),
        ends_at: dynamic_mid(&card["end_time"]).filter(|n| *n > 0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::{dynamic_item, DynamicKind};
    use serde_json::json;

    #[test]
    fn opus_retains_mentions_video_emoji_and_course() {
        let item = json!({
            "id_str": "1061528002205057025", "type": "DYNAMIC_TYPE_ARTICLE", "visible": true,
            "modules": {
                "module_tag": {"text":"置顶"},
                "module_dynamic": {
                    "major": {"type":"MAJOR_TYPE_OPUS", "opus":{"summary":{"text":"获奖作品", "rich_text_nodes":[
                        {"type":"RICH_TEXT_NODE_TYPE_AT","text":"@艾目江江 ","rid":"18639319"},
                        {"type":"RICH_TEXT_NODE_TYPE_BV","text":"获奖作品","rid":"BV1AeLBzBE9s"},
                        {"type":"RICH_TEXT_NODE_TYPE_EMOJI","text":"[给心心]","emoji":{"icon_url":"//i0.hdslb.com/bfs/emote/heart.png"}}
                    ]}}},
                    "additional": {"type":"ADDITIONAL_TYPE_COMMON","common":{"sub_type":"pugv","title":"用iPhone拍出电影感",
                        "head_text":"相关付费课程","desc1":"8节课","cover":"https://archive.biliimg.com/cover.jpg",
                        "jump_url":"https://m.bilibili.com/cheese/play/ss190402215"}}
                }
            }
        });
        let entry = dynamic_item(&item).unwrap();
        assert_eq!(entry.kind, DynamicKind::Opus);
        assert!(entry.pinned);
        assert!(matches!(
            &entry.nodes[0],
            DynamicNode::Mention { mid: 18639319, .. }
        ));
        assert!(
            matches!(&entry.nodes[1], DynamicNode::Video { bvid, .. } if bvid == "BV1AeLBzBE9s")
        );
        assert!(
            matches!(&entry.nodes[2], DynamicNode::Emoji { image, .. } if image.starts_with("https://"))
        );
        let course = entry.attachment.unwrap();
        assert_eq!(course.detail, "8节课");
        assert_eq!(
            course.cover.as_deref(),
            Some("https://archive.biliimg.com/cover.jpg")
        );
        assert_eq!(course.url, "https://m.bilibili.com/cheese/play/ss190402215");
        let mut hidden = item;
        hidden["visible"] = false.into();
        assert!(dynamic_item(&hidden).is_none());
    }

    #[test]
    fn vote_reservation_and_lottery_keep_the_official_destination() {
        let original = "https://t.bilibili.com/1157337542787334150";
        let vote = dynamic_attachment(
            &json!({"type":"ADDITIONAL_TYPE_VOTE","vote":{
                "title":"展示盒增加哪些功能","desc":"345人参与","end_time":"1745031707",
                "button":{"jump_url":"//www.bilibili.com/h5/vote?vote_id=14989681"}
            }}),
            original,
        )
        .unwrap();
        assert_eq!(vote.ends_at, Some(1745031707));
        assert_eq!(
            vote.url,
            "https://www.bilibili.com/h5/vote?vote_id=14989681"
        );

        let reservation = dynamic_attachment(&json!({"type":"ADDITIONAL_TYPE_RESERVE","reserve":{
            "title":"直播预约","desc1":{"text":"01-16 21:00 直播"},"desc2":{"text":"1499人预约"},
            "button":{"uncheck":{"text":"已结束","disable":1},"jump_url":""}
        }}), original).unwrap();
        assert_eq!(reservation.detail, "01-16 21:00 直播 · 1499人预约 · 已结束");
        assert_eq!(reservation.url, original);
        let lottery = dynamic_nodes(
            &json!([{"type":"RICH_TEXT_NODE_TYPE_LOTTERY","text":"互动抽奖","jump_url":""}]),
            original,
        );
        assert!(matches!(&lottery[0], DynamicNode::Link { url, .. } if url == original));

        let other = dynamic_attachment(&json!({"type":"ADDITIONAL_TYPE_MATCH"}), original).unwrap();
        assert_eq!(other.url, original);
        assert!(dynamic_web_url(&json!("file:///local-file")).is_none());
    }
}
