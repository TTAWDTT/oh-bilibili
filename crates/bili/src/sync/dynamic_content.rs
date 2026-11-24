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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DynamicDecoration {
    pub name: String,
    pub image: String,
    pub large: Option<String>,
    pub number: Option<String>,
    pub color: Option<String>,
    pub url: Option<String>,
}

pub(super) fn dynamic_decoration(card: &Value) -> Option<DynamicDecoration> {
    let large = dynamic_web_url(&card["big_card_url"]);
    let image = dynamic_web_url(&card["card_url"]).or_else(|| large.clone())?;
    let fan = &card["fan"];
    let number = if dynamic_mid(&fan["is_fan"]) == Some(1) {
        fan["num_desc"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|n| format!("{}{n}", fan["num_prefix"].as_str().unwrap_or_default()))
    } else {
        None
    };
    Some(DynamicDecoration {
        name: card["name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("动态装扮")
            .to_owned(),
        large: large.filter(|src| *src != image),
        image,
        number,
        color: fan["color"]
            .as_str()
            .filter(|s| {
                s.strip_prefix('#')
                    .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
            })
            .map(str::to_string),
        url: dynamic_web_url(&card["jump_url"]),
    })
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
        "ADDITIONAL_TYPE_GOODS" => {
            let goods = &value["goods"];
            let label = goods["head_text"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("推荐商品");
            let items = goods["items"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            if let [item] = items {
                return Some(DynamicAttachment {
                    label: label.into(),
                    title: item["name"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("查看商品")
                        .into(),
                    detail: [&item["price"], &item["brief"]]
                        .into_iter()
                        .filter_map(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(" · "),
                    cover: dynamic_web_url(&item["cover"]),
                    url: dynamic_web_url(&item["jump_url"]).unwrap_or_else(|| discussion.into()),
                    ends_at: None,
                });
            }
            let titles = items
                .iter()
                .filter_map(|item| item["name"].as_str())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            return Some(DynamicAttachment {
                label: label.into(),
                title: if items.is_empty() {
                    "在 B 站查看商品".into()
                } else {
                    format!("{} 件商品", items.len())
                },
                detail: titles.join("、"),
                cover: items
                    .first()
                    .and_then(|item| dynamic_web_url(&item["cover"])),
                url: discussion.into(),
                ends_at: None,
            });
        }
        "ADDITIONAL_TYPE_UPOWER_LOTTERY" => {
            let card = &value["upower_lottery"];
            let mut detail: Vec<_> = [&card["hint"], &card["desc"]]
                .into_iter()
                .filter(|field| field["visible"] == true)
                .map(|field| &field["text"])
                .collect();
            let button = &card["button"];
            if button["status"] == 2 && button["check"]["disable"] == 1 {
                detail.push(&button["check"]["text"]);
            }
            ("充电抽奖", card, detail)
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
    fn author_decoration_keeps_fan_number_and_pin() {
        let data = json!({
            "type": "DYNAMIC_TYPE_WORD", "id_str": "980592575466438663",
            "modules": { "module_author": { "is_top": true, "decoration_card": {
                "name":"2233夏日摇滚派对粉丝", "card_url":"https://i0.hdslb.com/bfs/garb/07926f3b3ce1aeaf5bb7701e2475bad8b6a5ce4e.png",
                "jump_url":"https://www.bilibili.com/h5/mall/equity-link/collect-home?item_id=1685952496002",
                "fan":{"is_fan":"1","num_desc":"000102","num_prefix":"","color":"#FB72BC"}
            } } }
        });
        let item = dynamic_item(&data).unwrap();
        assert!(item.pinned);
        let dress = item.decoration.unwrap();
        assert_eq!(dress.number.as_deref(), Some("000102"));
        assert_eq!(dress.color.as_deref(), Some("#FB72BC"));
        assert!(dress.url.unwrap().contains("item_id=1685952496002"));
        assert!(dynamic_decoration(&Value::Null).is_none());
    }

    #[test]
    fn product_card_keeps_the_cover_price_and_destination() {
        let origin = "https://t.bilibili.com/721282703208480790";
        let item = json!({"name":"啊脑袋周边抱枕","brief":"","price":"¥0",
            "cover":"https://i0.hdslb.com/bfs/sycp/dpa/202210/34dc0c3c990f87dc838893a9345d0ff0.jpg",
            "jump_url":"https://s.click.taobao.com/t?e=example","jump_desc":"去看看"});
        let mut value = json!({"type":"ADDITIONAL_TYPE_GOODS","goods":{"head_text":"UP主的推荐","items":[item]}});
        let card = dynamic_attachment(&value, origin).unwrap();
        assert_eq!(card.label, "UP主的推荐");
        assert_eq!(card.title, "啊脑袋周边抱枕");
        assert_eq!(card.detail, "¥0");
        assert_eq!(card.cover.as_deref(), item["cover"].as_str());
        assert_eq!(Some(card.url.as_str()), item["jump_url"].as_str());

        value["goods"]["items"]
            .as_array_mut()
            .unwrap()
            .push(json!({"name":"立牌"}));
        let group = dynamic_attachment(&value, origin).unwrap();
        assert_eq!(group.detail, "啊脑袋周边抱枕、立牌");
        assert_eq!(group.url, origin);
    }

    #[test]
    fn charging_lottery_shows_the_result_and_respects_hidden_fields() {
        let official = "https://www.bilibili.com/h5/lottery/result?business_id=907162007084466193&business_type=12";
        let mut attached = json!({"type":"ADDITIONAL_TYPE_UPOWER_LOTTERY","upower_lottery":{
            "title":"为TA充电专属抽奖","hint":{"text":"加入当前UP主的「6元档包月充电」即可参与","visible":false},
            "desc":{"text":"【大月卡】*5份","visible":false},"jump_url":official,
            "button":{"type":2,"check":{"text":"已结束","disable":1},"status":2}
        }});
        let parse = |value: &Value| {
            dynamic_attachment(value, "https://t.bilibili.com/907162007084466193").unwrap()
        };
        let ended = parse(&attached);
        assert_eq!(ended.title, "为TA充电专属抽奖");
        assert_eq!(ended.detail, "已结束");
        assert_eq!(ended.url, official);
        attached["upower_lottery"]["desc"]["visible"] = Value::Bool(true);
        assert_eq!(parse(&attached).detail, "【大月卡】*5份 · 已结束");
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
