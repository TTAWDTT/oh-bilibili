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
    /// 评论里 @ 到的用户：名字到 uid。正文里的 @名字 会做成可点链接。
    pub mentions: Vec<(String, u64)>,
    /// 评论者等级。B 站把 LV 牌挂在昵称后面。
    pub level: u8,
    pub likes: u32,
    /// Unix 秒。
    pub at: i64,
    /// 楼中楼预览。
    pub replies: Vec<Comment>,
    /// 楼中楼总数，比预览多时界面显示「共 N 条回复」。
    pub reply_count: u32,
    /// UP 主置顶。B 站在置顶评论上挂一个「UP主觉得很赞」的位置标记。
    pub pinned: bool,
    /// UP 主赞过这条评论。列表里挂一枚拇指。
    pub up_liked: bool,
    /// 当前登录账号赞过这条评论。接口 `action` 为 1，游客恒为 0。
    pub liked: bool,
    /// 评论者戴的粉丝牌。没戴时为 None。
    pub medal: Option<CommentMedal>,
}

/// 粉丝牌（接口里的 `member.fans_detail`）。颜色是 0xAARRGGBB，
/// 界面取低 24 位当 `#rrggbb`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentMedal {
    pub name: String,
    pub level: u32,
    pub color: u32,
    pub color_end: u32,
    pub color_border: u32,
    pub color_name: u32,
    pub color_level: u32,
    pub level_bg: u32,
}

/// 一页评论。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentPage {
    pub total: u32,
    /// 老的页码字段。翻页改游标后界面不再读它。
    pub page: u32,
    /// 下一页的游标。主评论列表和楼中楼都用它翻页；没有下一页时为 None。
    pub next: Option<String>,
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
    /// UP 主对这条评论的动作（赞/回复）。
    #[serde(default)]
    up_action: Option<RawUpAction>,
    /// 当前用户操作状态：0 无、1 已点赞、2 已点踩。
    #[serde(default)]
    action: u32,
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
    #[serde(default)]
    fans_detail: Option<RawFansDetail>,
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
struct RawFansDetail {
    #[serde(default)]
    medal_name: String,
    #[serde(default)]
    level: u32,
    #[serde(default)]
    medal_color: u32,
    #[serde(default)]
    medal_color_end: u32,
    #[serde(default)]
    medal_color_border: u32,
    #[serde(default)]
    medal_color_name: u32,
    #[serde(default)]
    medal_color_level: u32,
    #[serde(default)]
    medal_level_bg_color: u32,
}

#[derive(Deserialize)]
struct RawContent {
    #[serde(default)]
    message: String,
    #[serde(default)]
    emote: Option<HashMap<String, RawEmote>>,
    /// 被 @ 的用户。B 站只在真的有提及时给这个数组。
    #[serde(default)]
    members: Option<Vec<RawMention>>,
}

#[derive(Deserialize)]
struct RawEmote {
    #[serde(default)]
    url: String,
}

#[derive(Deserialize)]
struct RawMention {
    #[serde(default, deserialize_with = "u64_from_any")]
    mid: u64,
    #[serde(default)]
    uname: String,
}

#[derive(Deserialize)]
struct RawUpAction {
    #[serde(default)]
    like: bool,
}

fn to_comment(raw: RawReply) -> Comment {
    let up_liked = raw.up_action.as_ref().map(|a| a.like).unwrap_or(false);
    let liked = raw.action == 1;
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
    let medal = raw
        .member
        .as_ref()
        .and_then(|m| m.fans_detail.as_ref())
        .filter(|f| !f.medal_name.is_empty() && f.level > 0)
        .map(|f| CommentMedal {
            name: f.medal_name.clone(),
            level: f.level,
            color: f.medal_color,
            color_end: f.medal_color_end,
            color_border: f.medal_color_border,
            color_name: f.medal_color_name,
            color_level: f.medal_color_level,
            level_bg: f.medal_level_bg_color,
        });
    let replies = raw
        .replies
        .unwrap_or_default()
        .into_iter()
        .take(3)
        .map(to_comment)
        .collect();
    let (text, emotes, mentions) = raw
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
            let mentions = c
                .members
                .unwrap_or_default()
                .into_iter()
                .filter(|m| m.mid > 0 && !m.uname.is_empty())
                .map(|m| (m.uname, m.mid))
                .collect();
            (c.message, emotes, mentions)
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
        mentions,
        level,
        likes: raw.like,
        at: raw.ctime,
        replies,
        reply_count: raw.rcount,
        pinned: false,
        up_liked,
        liked,
        medal,
    }
}

/// 从 `x/v2/reply/wbi/main` 的响应里取一页评论。
///
/// 这个接口不用页码，翻页靠 `cursor.pagination_reply.next_offset` 游标；B 站桌面端
/// 和网页端的评论区现在都走它。老的 `x/v2/reply?pn=` 照样能用，但连翻几页就会被
/// -352/412 拦下，所以这里改成和官方客户端一致的协议。
pub fn cursor_page_from(value: &serde_json::Value, first: bool) -> CommentPage {
    let data = &value["data"];
    let cursor = &data["cursor"];
    let total = cursor["all_count"].as_u64().unwrap_or(0) as u32;
    let top = &data["upper"]["top"];
    let pinned_id = top["rpid_str"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| top["rpid"].as_u64().map(|n| n.to_string()));
    let parse = |r: &serde_json::Value| -> Option<Comment> {
        let mut c = to_comment(serde_json::from_value::<RawReply>(r.clone()).ok()?);
        c.pinned = Some(&c.id) == pinned_id.as_ref();
        Some(c)
    };
    let mut items: Vec<Comment> = data["replies"]
        .as_array()
        .map(|list| list.iter().filter_map(parse).collect())
        .unwrap_or_default();
    // 置顶只在第一页补：调用方知道这次是不是空游标发出去的。
    if first {
        if let Some(top) = data["top_replies"].as_array() {
            for raw in top {
                let Some(mut c) = parse(raw) else { continue };
                c.pinned = true;
                match items.iter().position(|x| x.id == c.id) {
                    Some(i) => {
                        let mut existing = items.remove(i);
                        existing.pinned = true;
                        items.insert(0, existing);
                    }
                    None => items.insert(0, c),
                }
            }
        }
    }
    let next = cursor["pagination_reply"]["next_offset"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let ended = cursor["is_end"].as_bool().unwrap_or(false);
    CommentPage {
        total,
        page: 1,
        has_more: !ended && next.is_some(),
        next,
        items,
    }
}

/// 从 `x/v2/reply/detail` 的响应里取一页楼中楼。
///
/// 官方桌面端的楼中楼列表就走这个接口，翻页靠不透明的
/// `cursor.pagination_reply.next_offset`；老的 `x/v2/reply/reply?pn=` 是页码协议。
/// `dialog/cursor` 只返回某一条二级评论的对话分支，不是整栋楼，别拿它列楼层。
pub fn detail_page_from(value: &serde_json::Value) -> CommentPage {
    let data = &value["data"];
    let root = &data["root"];
    // 真实响应里没有 data.page；总数在一级评论对象上。
    let total = root["rcount"]
        .as_u64()
        .or_else(|| data["page"]["count"].as_u64())
        .unwrap_or(0) as u32;
    let items: Vec<Comment> = root["replies"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    serde_json::from_value::<RawReply>(r.clone())
                        .ok()
                        .map(to_comment)
                })
                .collect()
        })
        .unwrap_or_default();
    let next = data["cursor"]["pagination_reply"]["next_offset"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let ended = data["cursor"]["is_end"].as_bool().unwrap_or(false);
    CommentPage {
        total,
        page: 0,
        has_more: !ended && next.is_some(),
        next,
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
                "cursor": { "all_count": 240921, "is_end": false, "pagination_reply": { "next_offset": "o1" } },
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
        let page = cursor_page_from(&sample(), true);
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
        let page = cursor_page_from(&sample(), true);
        assert_eq!(
            page.items[0].avatar.as_deref(),
            Some("https://i0.hdslb.com/a.jpg")
        );
    }

    #[test]
    fn up主赞过的评论带标记() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "cursor": { "all_count": 2, "is_end": false, "pagination_reply": { "next_offset": "o1" } },
                "replies": [
                    { "rpid_str": "1", "member": { "mid": 7, "uname": "A" },
                      "content": { "message": "被 UP 赞了" }, "like": 3, "ctime": 1,
                      "up_action": { "like": true, "reply": false } },
                    { "rpid_str": "2", "member": { "mid": 8, "uname": "B" },
                      "content": { "message": "普通" }, "like": 1, "ctime": 2,
                      "up_action": { "like": false, "reply": false } }
                ]
            }
        });
        let page = cursor_page_from(&value, true);
        assert!(page.items[0].up_liked);
        assert!(!page.items[1].up_liked);
    }

    #[test]
    fn 当前用户赞过的评论带liked() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "cursor": { "all_count": 2, "is_end": false, "pagination_reply": { "next_offset": "o1" } },
                "replies": [
                    { "rpid_str": "1", "member": { "mid": 7, "uname": "A" },
                      "content": { "message": "赞过" }, "like": 3, "ctime": 1, "action": 1 },
                    { "rpid_str": "2", "member": { "mid": 8, "uname": "B" },
                      "content": { "message": "点踩" }, "like": 1, "ctime": 2, "action": 2 }
                ]
            }
        });
        let page = cursor_page_from(&value, true);
        assert!(page.items[0].liked);
        assert!(!page.items[1].liked);
    }

    #[test]
    fn 评论里的艾特带出用户() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "cursor": { "all_count": 1, "is_end": false, "pagination_reply": { "next_offset": "o1" } },
                "replies": [
                    { "rpid_str": "1", "member": { "mid": 7, "uname": "A" },
                      "content": {
                        "message": "@冰冰冰冰茶茶茶 @心儿心儿xm 你们好",
                        "members": [
                          { "mid": "293604095", "uname": "冰冰冰冰茶茶茶" },
                          { "mid": 41405030, "uname": "心儿心儿xm" }
                        ]
                      },
                      "like": 1, "ctime": 1 }
                ]
            }
        });
        let page = cursor_page_from(&value, true);
        assert_eq!(
            page.items[0].mentions,
            vec![
                ("冰冰冰冰茶茶茶".to_string(), 293_604_095),
                ("心儿心儿xm".to_string(), 41_405_030)
            ]
        );
    }

    #[test]
    fn up主置顶的那条排在第一页最前并带标记() {
        // 真实结构：置顶评论在 top_replies，upper.rpid 指向它，普通分页里没有它。
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "cursor": { "all_count": 900, "is_end": false, "pagination_reply": { "next_offset": "o1" } },
                "upper": { "rpid_str": "999", "rpid": 999 },
                "top_replies": [
                    { "rpid_str": "999", "member": { "mid": 42, "uname": "UP" },
                      "content": { "message": "我在这里" }, "like": 10, "ctime": 1 }
                ],
                "replies": [
                    { "rpid_str": "111", "member": { "mid": 7, "uname": "观众" },
                      "content": { "message": "普通评论" }, "like": 1, "ctime": 2 }
                ]
            }
        });
        let page = cursor_page_from(&value, true);
        assert_eq!(page.items.len(), 2, "置顶不该和普通列表重复");
        assert_eq!(page.items[0].id, "999");
        assert!(page.items[0].pinned, "第一条应该是置顶");
        assert!(!page.items[1].pinned);
        // 游标翻到第二页时不再重复塞置顶
        let mut second = value.clone();
        second["data"]["cursor"]["pagination_reply"]["next_offset"] =
            serde_json::json!("o2");
        let later = cursor_page_from(&second, false);
        assert_eq!(later.items.len(), 1);
        assert!(!later.items[0].pinned);
    }

    #[test]
    fn mid用字符串给也能解析并带出等级与表情() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "cursor": { "all_count": 1, "is_end": false, "pagination_reply": { "next_offset": "o1" } },
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
        let page = cursor_page_from(&value, true);
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
        let page = cursor_page_from(&serde_json::json!({ "code": -404 }), true);
        assert_eq!(page.total, 0);
        assert!(page.items.is_empty());
        assert!(!page.has_more);
    }

    #[test]
    fn 有粉丝详情时解析出名字等级与颜色() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "cursor": { "all_count": 2, "is_end": false, "pagination_reply": { "next_offset": "o1" } },
                "replies": [
                    {
                        "rpid_str": "444",
                        "member": {
                            "mid": "946974",
                            "uname": "影视飓风",
                            "fans_detail": {
                                "medal_name": "飓风",
                                "level": 18,
                                "medal_color": 4294503408u32,
                                "medal_color_end": 4294503408u32,
                                "medal_color_border": 4289423504u32,
                                "medal_color_name": 4289423504u32,
                                "medal_color_level": 4292452534u32,
                                "medal_level_bg_color": 16777215u32
                            }
                        },
                        "content": { "message": "带粉丝牌" }
                    },
                    {
                        "rpid_str": "555",
                        "member": { "uname": "普通观众" },
                        "content": { "message": "没戴" }
                    }
                ]
            }
        });
        let page = cursor_page_from(&value, true);
        let medal = page.items[0]
            .medal
            .as_ref()
            .expect("带 fans_detail 的评论要有粉丝牌");
        assert_eq!(medal.name, "飓风");
        assert_eq!(medal.level, 18);
        assert_eq!(medal.color, 0xfff8ebf0);
        assert_eq!(medal.color_end, 0xfff8ebf0);
        assert_eq!(medal.color_border, 0xffab6890);
        assert_eq!(medal.color_name, 0xffab6890);
        assert_eq!(medal.color_level, 0xffd9a0b6);
        assert_eq!(medal.level_bg, 0x00ffffff);
        assert!(page.items[1].medal.is_none(), "没给 fans_detail 时不该有粉丝牌");
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
        let page = cursor_page_from(&raw, true);
        assert_eq!(page.items[0].replies.len(), 3);
        assert_eq!(page.items[0].reply_count, 3);
    }

    #[test]
    fn 楼中楼按游标解析出回复与下一页() {
        // 照抄真实响应（BV1GJ411x7h7 / root 3596982434）的形状：
        // 一级评论对象在 data.root，里层 replies 才是这一页的二级评论。
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "root": {
                    "rpid_str": "3596982434",
                    "rcount": 3442,
                    "replies": [
                        {
                            "rpid_str": "777",
                            "root": "3596982434",
                            "parent": "3596982434",
                            "dialog": "777",
                            "floor": 1,
                            "member": { "mid": "11", "uname": "甲" },
                            "content": { "message": "第一条回复" },
                            "like": 3,
                            "ctime": 100
                        },
                        {
                            "rpid_str": "888",
                            "root": "3596982434",
                            "parent": "777",
                            "dialog": "777",
                            "floor": 2,
                            "member": { "mid": "12", "uname": "乙" },
                            "content": { "message": "第二条回复" },
                            "like": 1,
                            "ctime": 101
                        }
                    ]
                },
                "cursor": {
                    "mode": 2,
                    "is_begin": true,
                    "is_end": false,
                    "pagination_reply": {
                        "next_offset": "offset-2"
                    }
                }
            }
        });
        let page = detail_page_from(&value);
        assert_eq!(page.total, 3442);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].author, "甲");
        assert_eq!(page.items[1].text, "第二条回复");
        assert_eq!(
            page.next.as_deref(),
            Some("offset-2")
        );
        assert!(page.has_more);
    }

    #[test]
    fn 楼中楼到底后不再要下一页() {
        let value = serde_json::json!({
            "code": 0,
            "data": {
                "root": { "rpid_str": "1", "rcount": 21, "replies": [] },
                "cursor": {
                    "is_end": true,
                    "pagination_reply": { "next_offset": "last" }
                }
            }
        });
        let page = detail_page_from(&value);
        assert_eq!(page.total, 21);
        assert!(page.items.is_empty());
        assert!(!page.has_more);
    }

    #[test]
    fn 楼中楼响应缺字段时给空页不报错() {
        let page = detail_page_from(&serde_json::json!({ "code": -404 }));
        assert_eq!(page.total, 0);
        assert!(page.items.is_empty());
        assert!(page.next.is_none());
        assert!(!page.has_more);
    }
}
