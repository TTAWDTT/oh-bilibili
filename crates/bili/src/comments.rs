//! 评论区。
//!
//! 解析在边界上做完，出去的都是领域类型：界面拿不到接口字段名，也就不会
//! 因为 B 站改字段而悄悄读到空值。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 一条评论。嵌套回复只带预览，展开要再请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    /// 评论者 uid。和视频作者对上时，界面标「UP主」。
    pub mid: u64,
    pub author: String,
    pub avatar: Option<String>,
    pub text: String,
    /// 评论里的 B 站表情：原文代号（如 `[doge]`）到图片地址。
    pub emotes: Vec<(String, String)>,
    /// 评论者等级。B 站把 LV 牌挂在昵称后面。
    pub level: u8,
    pub likes: u32,
    /// Unix 秒。
    pub at: i64,
    /// 楼中楼预览。
    pub replies: Vec<Comment>,
    /// 楼中楼总数，比预览多时界面显示「共 N 条回复」。
    pub reply_count: u32,
}

/// 一页评论。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentPage {
    pub total: u32,
    pub page: u32,
    pub items: Vec<Comment>,
    /// 还有下一页。
    pub has_more: bool,
}

#[derive(Deserialize)]
struct RawReply {
    #[serde(default)]
    rpid_str: Option<String>,
    #[serde(default)]
    rpid: Option<i64>,
    #[serde(default)]
    member: Option<RawMember>,
    #[serde(default)]
    content: Option<RawContent>,
    #[serde(default)]
    like: u32,
    #[serde(default)]
    ctime: i64,
    /// B 站对「没有楼中楼」的评论给的是 null 而不是 []，
    /// serde 的 default 只在字段缺失时生效，所以这里必须用 Option。
    #[serde(default)]
    replies: Option<Vec<RawReply>>,
    #[serde(default)]
    rcount: u32,
}

#[derive(Deserialize)]
struct RawMember {
    /// B 站这里给的是字符串（"946974"），按数字解析会把整页评论丢光。
    #[serde(default, deserialize_with = "u64_from_any")]
    mid: u64,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    avatar: String,
    #[serde(default)]
    level_info: Option<RawLevel>,
}

fn u64_from_any<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_u64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0))
}

#[derive(Deserialize)]
struct RawLevel {
    #[serde(default)]
    current_level: u64,
}

#[derive(Deserialize)]
struct RawContent {
    #[serde(default)]
    message: String,
    #[serde(default)]
    emote: Option<HashMap<String, RawEmote>>,
}

#[derive(Deserialize)]
struct RawEmote {
    #[serde(default)]
    url: String,
}

fn to_comment(raw: RawReply) -> Comment {
    let id = raw
        .rpid_str
        .filter(|s| !s.is_empty())
        .or_else(|| raw.rpid.map(|n| n.to_string()))
        .unwrap_or_default();
    let avatar = raw
        .member
        .as_ref()
        .map(|m| m.avatar.trim().to_string())
        .filter(|s| !s.is_empty());
    let mid = raw.member.as_ref().map(|m| m.mid).unwrap_or(0);
    let level = raw
        .member
        .as_ref()
        .and_then(|m| m.level_info.as_ref())
        .map(|l| l.current_level as u8)
        .unwrap_or(0);
    let replies = raw
        .replies
        .unwrap_or_default()
        .into_iter()
        .take(3)
        .map(to_comment)
        .collect();
    let (text, emotes) = raw
        .content
        .map(|c| {
            let emotes = c
                .emote
                .unwrap_or_default()
                .into_iter()
                .filter_map(|(code, e)| {
                    let url = e.url.trim();
                    if url.is_empty() {
                        None
                    } else {
                        Some((code, url.replacen("http://", "https://", 1)))
                    }
                })
                .collect();
            (c.message, emotes)
        })
        .unwrap_or_default();
    Comment {
        id,
        mid,
        author: raw.member.map(|m| m.uname).unwrap_or_default(),
        avatar: avatar.map(|a| {
            if a.starts_with("//") {
                format!("https:{a}")
            } else {
                a
            }
        }),
        text,
        emotes,
        level,
        likes: raw.like,
        at: raw.ctime,
        replies,
        reply_count: raw.rcount,
    }
}

/// 从 `x/v2/reply` 的响应里取一页评论。字段缺失时返回空页而不是报错，
/// 评论区拿不到内容不该挡住看视频。
pub fn page_from(value: &serde_json::Value, page: u32, per_page: u32) -> CommentPage {
    let data = &value["data"];
    let total = data["page"]["count"].as_u64().unwrap_or(0) as u32;
    let items: Vec<Comment> = data["replies"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|r| serde_json::from_value::<RawReply>(r.clone()).ok())
                .map(to_comment)
                .collect()
        })
        .unwrap_or_default();
    let loaded = page.saturating_mul(per_page);
    CommentPage {
        total,
        page,
        has_more: (loaded as u64) < total as u64 && !items.is_empty(),
        items,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> serde_json::Value {
        serde_json::json!({
            "code": 0,
            "data": {
                "page": { "count": 240921, "size": 3, "num": 1 },
                "replies": [
                    {
                        "rpid_str": "111",
                        "member": { "uname": "老咸鱼A", "avatar": "//i0.hdslb.com/a.jpg" },
                        "content": { "message": "坏消息：被骗了\n好消息：真好听" },
                        "like": 775313, "ctime": 1577835803, "rcount": 3,
                        "replies": [
                            { "rpid_str": "222", "member": { "uname": "B" },
                              "content": { "message": "回复一" }, "like": 5, "ctime": 1577835900 }
                        ]
                    }
                ]
            }
        })
    }

    #[test]
    fn 解析出作者文本与点赞() {
        let page = page_from(&sample(), 1, 20);
        assert_eq!(page.total, 240921);
        assert_eq!(page.items.len(), 1);
        let c = &page.items[0];
        assert_eq!(c.id, "111");
        assert_eq!(c.author, "老咸鱼A");
        assert!(c.text.contains("真好听"));
        assert_eq!(c.likes, 775313);
        assert_eq!(c.reply_count, 3);
        assert_eq!(c.replies.len(), 1);
        assert_eq!(c.replies[0].text, "回复一");
        assert!(page.has_more);
    }

    #[test]
    fn 头像是双斜杠时补协议() {
        let page = page_from(&sample(), 1, 20);
        assert_eq!(
            page.items[0].avatar.as_deref(),
            Some("https://i0.hdslb.com/a.jpg")
        );
    }

    #[test]
    fn mid用字符串给也能解析并带出等级与表情() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "page": { "count": 1 },
                "replies": [
                    {
                        "rpid_str": "333",
                        "member": {
                            "mid": "946974",
                            "uname": "老咸鱼A",
                            "level_info": { "current_level": 6 }
                        },
                        "content": {
                            "message": "好看 [doge]",
                            "emote": {
                                "[doge]": { "url": "http://i0.hdslb.com/bfs/emote/doge.png" }
                            }
                        },
                        "like": 1, "ctime": 1577835803
                    }
                ]
            }
        });
        let page = page_from(&value, 1, 20);
        let c = &page.items[0];
        assert_eq!(c.mid, 946974);
        assert_eq!(c.level, 6);
        assert_eq!(
            c.emotes,
            vec![(
                "[doge]".to_string(),
                "https://i0.hdslb.com/bfs/emote/doge.png".to_string()
            )]
        );
    }

    #[test]
    fn 字段缺失时给空页不报错() {
        let page = page_from(&serde_json::json!({ "code": -404 }), 1, 20);
        assert_eq!(page.total, 0);
        assert!(page.items.is_empty());
        assert!(!page.has_more);
    }

    #[test]
    fn 楼中楼预览最多三条() {
        let mut raw = sample();
        let many: Vec<serde_json::Value> = (0..6)
            .map(|i| serde_json::json!({
                "rpid_str": format!("{i}"),
                "member": { "uname": "x" },
                "content": { "message": "r" }
            }))
            .collect();
        raw["data"]["replies"][0]["replies"] = serde_json::Value::Array(many);
        let page = page_from(&raw, 1, 20);
        assert_eq!(page.items[0].replies.len(), 3);
        assert_eq!(page.items[0].reply_count, 3);
    }
}
