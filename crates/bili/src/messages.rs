//! B 站消息中心。

use serde::{Deserialize, Serialize};

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
    pub quote: String,
    pub at: u64,
    pub count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessagePage {
    pub items: Vec<MessageItem>,
    pub page: u32,
    pub has_more: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageUnread {
    pub reply: u64,
    pub at: u64,
    pub like: u64,
    pub total: u64,
}

fn message_page_from(
    _value: &serde_json::Value,
    _kind: MessageKind,
    _page: u32,
) -> MessagePage {
    todo!()
}

fn unread_from(_value: &serde_json::Value) -> MessageUnread {
    todo!()
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
