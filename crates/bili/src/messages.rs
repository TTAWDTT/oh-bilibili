//! B 站消息中心。

use serde::{Deserialize, Serialize};

use crate::client::{Client, API};
use crate::error::BiliError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Reply,
    At,
    Like,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageUser {
    pub mid: u64,
    pub name: String,
    pub avatar: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageItem {
    pub id: String,
    pub kind: MessageKind,
    pub users: Vec<MessageUser>,
    pub title: String,
    pub cover: Option<String>,
    pub url: String,
    pub bvid: Option<String>,
    pub quote: String,
    pub at: u64,
    pub count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessagePage {
    pub items: Vec<MessageItem>,
    pub page: u32,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageUnread {
    pub reply: u64,
    pub at: u64,
    pub like: u64,
    pub total: u64,
}

impl Client {
    pub async fn message_unread(&self) -> Result<MessageUnread, BiliError> {
        let value = self
            .get_json(
                &format!("{API}/x/msgfeed/unread"),
                std::time::Duration::from_millis(400),
            )
            .await?;
        Ok(unread_from(&value))
    }

    pub async fn messages(
        &self,
        kind: MessageKind,
        cursor: Option<String>,
        page: u32,
    ) -> Result<MessagePage, BiliError> {
        let url = messages_url(kind, cursor.as_deref())?;
        let value = self
            .get_json(&url, std::time::Duration::from_millis(400))
            .await?;
        Ok(message_page_from(&value, kind, page))
    }
}

fn messages_url(kind: MessageKind, cursor: Option<&str>) -> Result<String, BiliError> {
    let category = match kind {
        MessageKind::Reply => "reply",
        MessageKind::At => "at",
        MessageKind::Like => "like",
    };
    let mut url = format!("{API}/x/msgfeed/{category}?platform=web&build=0&mobi_app=web&ps=20");
    if let Some(cursor) = cursor {
        let (id, time) = cursor
            .split_once(':')
            .and_then(|(id, time)| Some((id.parse::<u64>().ok()?, time.parse::<u64>().ok()?)))
            .ok_or_else(|| BiliError::Parse("消息游标无效".to_string()))?;
        url.push_str(&format!("&id={id}&{}={time}", message_time_key(kind)));
    }
    Ok(url)
}

fn message_time_key(kind: MessageKind) -> &'static str {
    match kind {
        MessageKind::Reply => "reply_time",
        MessageKind::At => "at_time",
        MessageKind::Like => "like_time",
    }
}

fn message_page_from(value: &serde_json::Value, kind: MessageKind, page: u32) -> MessagePage {
    let data = if kind == MessageKind::Like {
        &value["data"]["total"]
    } else {
        &value["data"]
    };
    let items = data["items"]
        .as_array()
        .map(|list| list.iter().map(|entry| message_item_from(entry, kind)).collect())
        .unwrap_or_default();
    let cursor = &data["cursor"];
    let has_more = !cursor["is_end"].as_bool().unwrap_or(true);
    let next_cursor = if has_more {
        cursor["id"]
            .as_u64()
            .zip(cursor["time"].as_u64())
            .map(|(id, time)| format!("{id}:{time}"))
    } else {
        None
    };
    MessagePage {
        items,
        page,
        has_more,
        next_cursor,
    }
}

fn message_item_from(entry: &serde_json::Value, kind: MessageKind) -> MessageItem {
    let item = &entry["item"];
    let url = item["uri"].as_str().unwrap_or_default().to_string();
    let bvid = url
        .split("/video/")
        .nth(1)
        .map(|tail| tail.split(['/', '?', '#']).next().unwrap_or_default())
        .filter(|id| {
            id.len() == 12 && id.starts_with("BV") && id.bytes().all(|c| c.is_ascii_alphanumeric())
        })
        .map(str::to_string);
    let users = if kind == MessageKind::Like {
        entry["users"]
            .as_array()
            .map(|users| users.iter().map(message_user_from).collect())
            .unwrap_or_default()
    } else {
        vec![message_user_from(&entry["user"])]
    };
    let quote_key = if kind == MessageKind::Like {
        "desc"
    } else {
        "source_content"
    };
    MessageItem {
        id: entry["id"]
            .as_u64()
            .map(|id| id.to_string())
            .unwrap_or_else(|| entry["id"].as_str().unwrap_or_default().to_string()),
        kind,
        users,
        title: item["title"].as_str().unwrap_or_default().to_string(),
        cover: item["image"]
            .as_str()
            .filter(|url| !url.is_empty())
            .map(|url| url.replacen("http://", "https://", 1)),
        url,
        bvid,
        quote: item[quote_key].as_str().unwrap_or_default().to_string(),
        at: entry[message_time_key(kind)].as_u64().unwrap_or_default(),
        count: entry["counts"].as_u64().unwrap_or(1),
    }
}

fn message_user_from(value: &serde_json::Value) -> MessageUser {
    MessageUser {
        mid: value["mid"].as_u64().unwrap_or_default(),
        name: value["nickname"].as_str().unwrap_or_default().to_string(),
        avatar: value["avatar"]
            .as_str()
            .unwrap_or_default()
            .replacen("http://", "https://", 1),
    }
}

fn unread_from(value: &serde_json::Value) -> MessageUnread {
    let data = &value["data"];
    let reply = data["reply"].as_u64().unwrap_or_default();
    let at = data["at"].as_u64().unwrap_or_default();
    let like = data["like"].as_u64().unwrap_or_default();
    MessageUnread {
        reply,
        at,
        like,
        total: reply + at + like,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 回复消息取用户正文视频与毫秒时间() {
        let value = json!({
            "data": {
                "cursor": { "is_end": false },
                "items": [{
                    "id": 1123756542017547_u64,
                    "user": {
                        "mid": 1166736427,
                        "nickname": "默默-默笙",
                        "avatar": "https://i0.hdslb.com/face.jpg"
                    },
                    "item": {
                        "title": "同济大学24国豪高程期末大作业",
                        "image": "http://i1.hdslb.com/cover.jpg",
                        "uri": "https://www.bilibili.com/video/BV1JxNnz9ENZ",
                        "source_content": "求一个贪吃蛇"
                    },
                    "counts": 1,
                    "reply_time": 1785296619_u64
                }]
            }
        });

        let page = message_page_from(&value, MessageKind::Reply, 1);
        assert_eq!(page.items.len(), 1);
        let item = &page.items[0];
        assert_eq!(item.kind, MessageKind::Reply);
        assert_eq!(item.users[0].name, "默默-默笙");
        assert_eq!(item.quote, "求一个贪吃蛇");
        assert_eq!(item.cover.as_deref(), Some("https://i1.hdslb.com/cover.jpg"));
        assert_eq!(item.at, 1_785_296_619);
        assert!(page.has_more);
    }

    #[test]
    fn at_消息取被提及的那条评论() {
        let value = json!({
            "data": {
                "cursor": { "is_end": true },
                "items": [{
                    "id": 694642073067529_u64,
                    "user": {
                        "mid": 506211595,
                        "nickname": "撒沙鲨杀傻莎莎",
                        "avatar": "https://i1.hdslb.com/face.jpg"
                    },
                    "item": {
                        "title": "壁柜园",
                        "image": "",
                        "uri": "https://www.bilibili.com/video/BV1kKiCYsEvj",
                        "source_content": "@-芜芜芜芜芜芜芜湖- 哈哈哈哈哈哈哈"
                    },
                    "at_time": 1734142180_u64
                }]
            }
        });

        let page = message_page_from(&value, MessageKind::At, 2);
        let item = &page.items[0];
        assert_eq!(item.kind, MessageKind::At);
        assert_eq!(item.quote, "@-芜芜芜芜芜芜芜湖- 哈哈哈哈哈哈哈");
        assert_eq!(item.cover, None);
        assert_eq!(item.at, 1_734_142_180);
        assert!(!page.has_more);
    }

    #[test]
    fn 引用里的_at_用户保留成可点名单() {
        let value = json!({
            "data": {
                "cursor": { "is_end": true },
                "items": [{
                    "id": 694642073067530_u64,
                    "user": {
                        "mid": 506211595,
                        "nickname": "撒沙鲨杀傻莎莎",
                        "avatar": "https://i1.hdslb.com/face.jpg"
                    },
                    "item": {
                        "title": "壁柜园",
                        "image": "",
                        "uri": "https://www.bilibili.com/video/BV1kKiCYsEvj",
                        "source_content": "@测试UP 这段副歌太好听了",
                        "at_details": [
                            {
                                "mid": 1960976249_u64,
                                "nickname": "测试UP",
                                "avatar": "https://i2.hdslb.com/face.jpg"
                            },
                            {
                                "mid": 7_u64,
                                "nickname": "",
                                "avatar": ""
                            }
                        ]
                    },
                    "at_time": 1734142181_u64
                }]
            }
        });

        let page = message_page_from(&value, MessageKind::At, 2);
        assert_eq!(
            page.items[0].mentions,
            vec![MessageMention {
                mid: 1_960_976_249,
                name: "测试UP".to_string()
            }]
        );
    }

    #[test]
    fn 获赞消息保留多人与点赞总数() {
        let value = json!({
            "data": {
                "total": {
                    "cursor": { "is_end": false },
                    "items": [{
                        "id": 1150594165293056_u64,
                        "users": [
                            {
                                "mid": 535078340,
                                "nickname": "Speraymer",
                                "avatar": "https://i2.hdslb.com/a.jpg"
                            },
                            {
                                "mid": 551452953,
                                "nickname": "-歌氷麗月-",
                                "avatar": "https://i0.hdslb.com/b.jpg"
                            }
                        ],
                        "item": {
                            "title": "当你把wallpaper engine接入到了vibe coding软件……",
                            "desc": "https://github.com/TTAWDTT/dsh-plugin-wallpapers",
                            "image": "http://i2.hdslb.com/cover.jpg",
                            "uri": "https://www.bilibili.com/video/BV1Hote6gEKm"
                        },
                        "counts": 5,
                        "like_time": 1788896933_u64
                    }]
                }
            }
        });

        let page = message_page_from(&value, MessageKind::Like, 1);
        let item = &page.items[0];
        assert_eq!(item.kind, MessageKind::Like);
        assert_eq!(item.users.len(), 2);
        assert_eq!(item.count, 5);
        assert_eq!(item.quote, "https://github.com/TTAWDTT/dsh-plugin-wallpapers");
        assert_eq!(item.at, 1_788_896_933);
        assert!(page.has_more);
    }

    #[test]
    fn 视频链接提取编号并保留外链() {
        let mut value = json!({
            "data": {
                "cursor": { "is_end": true },
                "items": [{
                    "id": "message-1",
                    "user": { "mid": 1, "nickname": "UP", "avatar": "http://i0.hdslb.com/avatar.jpg" },
                    "item": { "uri": "https://www.bilibili.com/video/BV1JxNnz9ENZ/?p=2#reply" }
                }]
            }
        });
        let page = message_page_from(&value, MessageKind::Reply, 1);
        assert_eq!(page.items[0].bvid.as_deref(), Some("BV1JxNnz9ENZ"));
        assert_eq!(page.items[0].users[0].avatar, "https://i0.hdslb.com/avatar.jpg");
        value["data"]["items"][0]["item"]["uri"] = json!("https://t.bilibili.com/123");
        let page = message_page_from(&value, MessageKind::Reply, 1);
        assert_eq!(page.items[0].bvid, None);
        assert_eq!(page.items[0].url, "https://t.bilibili.com/123");
    }

    #[test]
    fn 三类续页游标使用对应时间参数() {
        for (kind, category, time_key) in [
            (MessageKind::Reply, "reply", "reply_time"),
            (MessageKind::At, "at", "at_time"),
            (MessageKind::Like, "like", "like_time"),
        ] {
            let data = json!({
                "cursor": { "is_end": false, "id": 9_007_199_254_740_993_u64, "time": 1762914540 },
                "items": []
            });
            let value = if kind == MessageKind::Like {
                json!({ "data": { "total": data } })
            } else {
                json!({ "data": data })
            };
            let page = message_page_from(&value, kind, 1);
            assert_eq!(page.next_cursor.as_deref(), Some("9007199254740993:1762914540"));
            let url = messages_url(kind, page.next_cursor.as_deref()).expect("续页地址");
            assert_eq!(url, format!("{API}/x/msgfeed/{category}?platform=web&build=0&mobi_app=web&ps=20&id=9007199254740993&{time_key}=1762914540"));
            let first = messages_url(kind, None).expect("首屏地址");
            assert!(!first.contains("&id="));
            assert!(!first.contains("&pn="));
        }
    }

    #[test]
    fn 最后一页不返回续页游标() {
        let value = json!({ "data": {
            "cursor": { "is_end": true, "id": 123, "time": 456 }, "items": []
        }});
        let page = message_page_from(&value, MessageKind::Reply, 2);
        assert!(!page.has_more);
        assert_eq!(page.next_cursor, None);
        assert!(messages_url(MessageKind::Reply, Some("invalid")).is_err());
    }

    #[test]
    fn 未读统计三类相加为总数() {
        let value = json!({
            "data": { "reply": 3, "at": 2, "like": 5, "sys_msg": 7 }
        });
        let unread = unread_from(&value);
        assert_eq!(unread.reply, 3);
        assert_eq!(unread.at, 2);
        assert_eq!(unread.like, 5);
        assert_eq!(unread.total, 10);
    }
}
