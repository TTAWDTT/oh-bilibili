//! B 站消息中心的一对一私信。

mod cards;
pub use cards::DirectCard;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{client::API, error::BiliError, Source};

const IM: &str = "https://api.vc.bilibili.com";
const INTERVAL: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectSession {
    pub mid: u64,
    pub name: String,
    pub avatar: String,
    pub preview: String,
    pub at: u64,
    pub unread: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectSessions {
    pub items: Vec<DirectSession>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectMessage {
    pub id: String,
    pub sender_mid: u64,
    pub text: String,
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cards: Vec<DirectCard>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub emotes: Vec<(String, String)>,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectHistory {
    pub items: Vec<DirectMessage>,
    pub withdrawals: Vec<DirectWithdrawal>,
    pub next_cursor: Option<String>,
    pub latest_seqno: Option<String>,
    pub latest_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectWithdrawal {
    pub target_id: String,
    pub remove: bool,
}

impl Source {
    pub async fn direct_sessions(&self, cursor: Option<u64>) -> Result<DirectSessions, BiliError> {
        let mut params = vec![
            ("session_type", "1".into()),
            ("group_fold", "1".into()),
            ("unfollow_fold", "0".into()),
            ("sort_rule", "2".into()),
            ("size", "20".into()),
            ("build", "0".into()),
            ("mobi_app", "web".into()),
        ];
        if let Some(end) = cursor {
            params.push(("end_ts", end.to_string()));
        }
        let value = self
            .client
            .signed_get(
                &format!("{IM}/session_svr/v1/session_svr/get_sessions"),
                params,
                INTERVAL,
            )
            .await
            .map_err(direct_error)?;
        let mut page = sessions_from(&value["data"], cursor)?;
        if !page.items.is_empty() {
            let ids = page
                .items
                .iter()
                .map(|session| session.mid.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let url = format!(
                "{API}/x/polymer/pc-electron/v1/user/cards?uids={ids}&build=0&mobi_app=web"
            );
            if let Ok(cards) = self.client.get_json(&url, INTERVAL).await {
                fill_user_cards(&mut page.items, &cards["data"]);
            }
        }
        Ok(page)
    }

    pub async fn direct_history(
        &self,
        owner: u64,
        mid: u64,
        cursor: Option<u64>,
    ) -> Result<DirectHistory, BiliError> {
        let mut params = vec![
            ("talker_id", mid.to_string()),
            ("session_type", "1".into()),
            ("size", "20".into()),
            ("sender_device_id", "1".into()),
            ("build", "0".into()),
            ("mobi_app", "web".into()),
        ];
        if let Some(end) = cursor {
            params.push(("end_seqno", end.to_string()));
        }
        let value = self
            .client
            .signed_get(
                &format!("{IM}/svr_sync/v1/svr_sync/fetch_session_msgs"),
                params,
                INTERVAL,
            )
            .await
            .map_err(direct_error)?;
        history_from(&value["data"], owner, mid, cursor)
    }

    pub async fn send_direct_text(
        &self,
        owner: u64,
        mid: u64,
        text: String,
        device: &str,
    ) -> Result<DirectMessage, BiliError> {
        self.send_direct(owner, mid, 1, json!({"content": text}), device)
            .await
    }

    pub async fn send_direct_image(
        &self,
        owner: u64,
        mid: u64,
        mime: &str,
        encoded: &str,
        device: &str,
    ) -> Result<DirectMessage, BiliError> {
        use base64::Engine as _;
        let image_type = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpeg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            _ => {
                return Err(BiliError::Parse(
                    "请选择 PNG、JPEG、GIF 或 WebP 图片".into(),
                ))
            }
        };
        let limit = if image_type == "gif" {
            1024 * 1024
        } else {
            20 * 1024 * 1024
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| BiliError::Parse("无法读取所选图片".into()))?;
        if bytes.is_empty() || bytes.len() > limit {
            return Err(BiliError::Parse(
                "图片为空或超过大小限制（GIF 1 MB，其他图片 20 MB）".into(),
            ));
        }
        let csrf = self.direct_csrf()?;
        let file = reqwest::multipart::Part::bytes(bytes)
            .file_name(format!("image.{image_type}"))
            .mime_str(mime)
            .map_err(|_| BiliError::Parse("图片格式有误".into()))?;
        let form = reqwest::multipart::Form::new()
            .part("file_up", file)
            .text("biz", "im")
            .text("csrf", csrf);
        let response = self
            .client
            .post_session(&format!("{API}/x/dynamic/feed/draw/upload_bfs"), |req| {
                req.multipart(form)
            })
            .await
            .map_err(direct_error)?;
        let image = direct_image_content(&response["data"], image_type)?;
        if self.nav().mid != Some(owner) {
            return Err(BiliError::NeedsLogin(
                "登录账号已更换，请重新选择联系人".into(),
            ));
        }
        self.send_direct(owner, mid, 2, image, device).await
    }

    async fn send_direct(
        &self,
        owner: u64,
        mid: u64,
        kind: u64,
        content: Value,
        device: &str,
    ) -> Result<DirectMessage, BiliError> {
        let csrf = self.direct_csrf()?;
        let url = self
            .client
            .signed_url(
                &format!("{IM}/web_im/v1/web_im/send_msg"),
                &[
                    ("w_sender_uid", owner.to_string()),
                    ("w_receiver_id", mid.to_string()),
                    ("w_dev_id", device.to_owned()),
                ],
            )
            .await
            .map_err(direct_error)?;
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let form = message_form(owner, mid, kind, &content, device, at, csrf);
        let receipt = self
            .client
            .post_form(&url, form)
            .await
            .map_err(|error| match error {
                BiliError::Network(_) | BiliError::Blocked { .. } => {
                    BiliError::Network("未收到发送回执，请刷新对话确认是否已送达".into())
                }
                other => other,
            })?;
        let (text, image) = message_content(&json!({"msg_type": kind, "content": content}));
        let mut message = sent_message(&receipt["data"], owner, text, at)?;
        message.image = image;
        Ok(message)
    }

    pub async fn direct_ack(&self, mid: u64, seqno: u64) -> Result<(), BiliError> {
        let csrf = self.direct_csrf()?;
        self.client
            .post_form(
                &format!("{IM}/session_svr/v1/session_svr/update_ack"),
                ack_form(mid, seqno, csrf),
            )
            .await
            .map_err(direct_error)?;
        Ok(())
    }

    fn direct_csrf(&self) -> Result<String, BiliError> {
        self.client
            .csrf()
            .ok_or_else(|| BiliError::NeedsLogin("请重新登录后再操作私信".into()))
    }
}

fn direct_error(error: BiliError) -> BiliError {
    match error {
        // classify 保留非 JSON 响应的开头供排查，私信返回体可能带有聊天正文。
        BiliError::Blocked { status, .. } => {
            BiliError::Network(format!("私信接口暂时无法读取（HTTP {status}）"))
        }
        other => other,
    }
}

fn number(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn flag(value: &Value) -> bool {
    value.as_bool().unwrap_or_else(|| number(value) == Some(1))
}

fn page_rows<'a>(data: &'a Value, field: &str) -> Result<&'a [Value], BiliError> {
    match data.get(field) {
        Some(Value::Array(rows)) => Ok(rows),
        Some(Value::Null) => Ok(&[]),
        None if data.is_object() && number(&data["has_more"]) == Some(0) => Ok(&[]),
        _ => Err(BiliError::Parse("私信列表格式有误".into())),
    }
}

fn older_cursor(data: &Value, previous: Option<u64>, next: Option<u64>) -> Option<String> {
    if !flag(&data["has_more"]) {
        return None;
    }
    next.filter(|&n| n > 0 && previous.map_or(true, |p| n < p))
        .map(|v| v.to_string())
}

fn sessions_from(data: &Value, cursor: Option<u64>) -> Result<DirectSessions, BiliError> {
    let rows = page_rows(data, "session_list")?;
    // end_ts 以整页最后一项为准，哪怕它是不会展示的群聊或系统通知。
    let next_cursor = older_cursor(
        data,
        cursor,
        rows.last().and_then(|s| number(&s["session_ts"])),
    );
    let items = rows
        .iter()
        .filter_map(|s| {
            if number(&s["session_type"]) != Some(1)
                || number(&s["system_msg_type"]).unwrap_or(0) != 0
                || (flag(&s["is_intercept"]) && !flag(&s["is_trust"]))
            {
                return None;
            }
            let mid = number(&s["talker_id"]).filter(|&id| id > 0)?;
            let msg = &s["last_msg"];
            let preview = if msg.is_null() {
                String::new()
            } else {
                message_content(msg).0
            };
            Some(DirectSession {
                mid,
                name: format!("UID {mid}"),
                avatar: String::new(),
                preview,
                at: number(&msg["timestamp"])
                    .unwrap_or_else(|| number(&s["session_ts"]).unwrap_or(0) / 1_000_000),
                unread: number(&s["unread_count"]).unwrap_or(0),
            })
        })
        .collect();
    Ok(DirectSessions { items, next_cursor })
}

fn fill_user_cards(sessions: &mut [DirectSession], cards: &Value) {
    for session in sessions {
        let card = &cards[session.mid.to_string()];
        if let Some(name) = card["name"].as_str().filter(|n| !n.is_empty()) {
            session.name = name.to_owned();
        }
        session.avatar = media_url(&card["face"]).unwrap_or_default();
    }
}

fn history_from(
    data: &Value,
    owner: u64,
    mid: u64,
    cursor: Option<u64>,
) -> Result<DirectHistory, BiliError> {
    let rows = page_rows(data, "messages")?;
    let emotes: Vec<_> = data["e_infos"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = entry["text"].as_str()?.trim();
            if !name.starts_with('[') || !name.ends_with(']') {
                return None;
            }
            let image = media_url(&entry["gif_url"]).or_else(|| media_url(&entry["url"]))?;
            Some((name, image))
        })
        .collect();
    let mut withdrawals = Vec::new();
    let mut latest = None;
    let mut first = None;
    let mut entries: Vec<_> = rows
        .iter()
        .filter_map(|msg| {
            let sender_mid = number(&msg["sender_uid"])?;
            let receiver = number(&msg["receiver_id"])?;
            if number(&msg["receiver_type"]) != Some(1)
                || !((sender_mid == mid && receiver == owner)
                    || (sender_mid == owner && receiver == mid))
            {
                return None;
            }
            let seqno = number(&msg["msg_seqno"])?;
            let at = number(&msg["timestamp"]).unwrap_or_default();
            if number(&msg["msg_type"]) == Some(5) {
                withdrawals.push(DirectWithdrawal {
                    target_id: number(&msg["content"])?.to_string(),
                    remove: flag(&msg["sys_cancel"]),
                });
                latest = latest.max(Some((seqno, at)));
                first = Some(first.map_or(seqno, |n: u64| n.min(seqno)));
                return None;
            }
            let id = number(&msg["msg_key"])?.to_string();
            latest = latest.max(Some((seqno, at)));
            first = Some(first.map_or(seqno, |n: u64| n.min(seqno)));
            let (text, image, cards) = received_content(msg, sender_mid);
            Some((
                seqno,
                DirectMessage {
                    id,
                    sender_mid,
                    emotes: emotes
                        .iter()
                        .filter(|(name, _)| text.contains(name))
                        .map(|(name, url)| ((*name).to_owned(), url.clone()))
                        .collect(),
                    text,
                    image,
                    cards,
                    at,
                },
            ))
        })
        .collect();
    entries.sort_by_key(|entry| entry.0);
    let min_seqno = number(&data["min_seqno"]).or(first);
    let next_cursor = older_cursor(data, cursor, min_seqno);
    Ok(DirectHistory {
        items: entries.into_iter().map(|entry| entry.1).collect(),
        withdrawals,
        next_cursor,
        latest_seqno: latest.map(|(seq, _)| seq.to_string()),
        latest_at: latest.map(|(_, at)| at),
    })
}

fn received_content(msg: &Value, sender: u64) -> (String, Option<String>, Vec<DirectCard>) {
    let Some((kind, content)) = message_payload(msg) else {
        return ("消息已撤回".into(), None, Vec::new());
    };
    let cards = cards::received_cards(kind, &content, sender);
    let (text, image) = if cards.is_empty() || kind == 16 {
        describe_message(kind, &content)
    } else {
        let attached = if matches!(kind, 11 | 12) {
            content["attach_msg"]["content"]
                .as_str()
                .unwrap_or_default()
        } else {
            ""
        };
        (attached.to_owned(), None)
    };
    (text, image, cards)
}

fn message_content(msg: &Value) -> (String, Option<String>) {
    match message_payload(msg) {
        Some((kind, content)) => describe_message(kind, &content),
        None => ("消息已撤回".into(), None),
    }
}

fn message_payload(msg: &Value) -> Option<(u64, std::borrow::Cow<'_, Value>)> {
    let kind = number(&msg["msg_type"]).unwrap_or_default();
    if number(&msg["msg_status"]) == Some(1) || matches!(kind, 5 | 8) {
        return None;
    }
    let content = match &msg["content"] {
        Value::String(s) => std::borrow::Cow::Owned(serde_json::from_str(s).unwrap_or(Value::Null)),
        v => std::borrow::Cow::Borrowed(v),
    };
    Some((kind, content))
}

fn describe_message(kind: u64, content: &Value) -> (String, Option<String>) {
    let title = content["title"].as_str().unwrap_or_default();
    let label = match kind {
        1 => content["content"]
            .as_str()
            .unwrap_or("[文本消息]")
            .to_owned(),
        2 | 6 => {
            let label = if kind == 2 { "[图片]" } else { "[表情]" };
            return (label.into(), media_url(&content["url"]));
        }
        3 => "[语音] 请在哔哩哔哩手机端收听".into(),
        4 | 7 | 14 | 15 => format!("[分享]{title}"),
        9 => "[小程序] 请在哔哩哔哩手机端查看".into(),
        10 | 13 if !title.is_empty() => title.to_owned(),
        11 | 17 => format!("[视频]{title}"),
        12 => format!("[文章]{title}"),
        16 => content["reply_content"]
            .as_str()
            .unwrap_or("[自动回复]")
            .to_owned(),
        _ => "[此类消息请在哔哩哔哩查看]".into(),
    };
    (label, None)
}

fn media_url(value: &Value) -> Option<String> {
    let raw = value.as_str()?;
    if let Some(rest) = raw.strip_prefix("//") {
        return Some(format!("https://{rest}"));
    }
    let mut url = reqwest::Url::parse(raw).ok()?;
    match url.scheme() {
        "http" => url.set_scheme("https").ok()?,
        "https" => {}
        _ => return None,
    }
    Some(url.into())
}

fn direct_image_content(data: &Value, image_type: &str) -> Result<Value, BiliError> {
    let url = media_url(&data["image_url"]);
    match (
        url,
        number(&data["image_width"]),
        number(&data["image_height"]),
        data["img_size"].as_f64(),
    ) {
        (Some(url), Some(width), Some(height), Some(size)) if width > 0 && height > 0 => {
            Ok(json!({
                "url":url, "width":width, "height":height, "size":size, "imageType":image_type, "original":1
            }))
        }
        _ => Err(BiliError::Parse("图片上传后没有收到完整回执".into())),
    }
}

fn message_form(
    owner: u64,
    mid: u64,
    kind: u64,
    content: &Value,
    device: &str,
    at: u64,
    csrf: String,
) -> Vec<(&'static str, String)> {
    vec![
        ("msg[sender_uid]", owner.to_string()),
        ("msg[receiver_type]", "1".into()),
        ("msg[receiver_id]", mid.to_string()),
        ("msg[msg_type]", kind.to_string()),
        ("msg[msg_status]", "0".into()),
        ("msg[content]", content.to_string()),
        ("msg[new_face_version]", "0".into()),
        ("msg[dev_id]", device.into()),
        ("msg[timestamp]", at.to_string()),
        ("from_firework", "0".into()),
        ("build", "0".into()),
        ("mobi_app", "web".into()),
        ("csrf_token", csrf.clone()),
        ("csrf", csrf),
    ]
}

fn ack_form(mid: u64, seqno: u64, csrf: String) -> Vec<(&'static str, String)> {
    vec![
        ("talker_id", mid.to_string()),
        ("session_type", "1".into()),
        ("ack_seqno", seqno.to_string()),
        ("build", "0".into()),
        ("mobi_app", "web".into()),
        ("csrf_token", csrf.clone()),
        ("csrf", csrf),
    ]
}

fn sent_message(
    receipt: &Value,
    owner: u64,
    text: String,
    at: u64,
) -> Result<DirectMessage, BiliError> {
    let id = number(&receipt["msg_key"])
        .filter(|&key| key > 0)
        .ok_or_else(|| BiliError::Parse("未收到消息编号，请刷新对话确认是否已送达".into()))?;
    Ok(DirectMessage {
        id: id.to_string(),
        sender_mid: owner,
        text,
        image: None,
        cards: Vec::new(),
        emotes: Vec::new(),
        at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn 图片上传回执生成私信图像消息且缺失回执不发信() {
        let content = direct_image_content(&json!({"image_url":"//i0.hdslb.com/test.png","image_width":120,"image_height":80,"img_size":1.5}), "png").unwrap();
        assert_eq!(content["original"], 1);
        assert_eq!(content["size"], 1.5);
        assert_eq!(content["imageType"], "png");
        let form: HashMap<_, _> = message_form(7, 9, 2, &content, "desktop", 44, "test".into())
            .into_iter()
            .collect();
        assert_eq!(form["msg[msg_type]"], "2");
        assert_eq!(
            serde_json::from_str::<Value>(&form["msg[content]"]).unwrap()["url"],
            "https://i0.hdslb.com/test.png"
        );
        assert!(
            direct_image_content(&json!({"image_url":"//i0.hdslb.com/missing.png"}), "png")
                .is_err()
        );
    }

    #[test]
    fn 私信列表仅收一对一且沿原始页末翻页() {
        let data = json!({
            "has_more": 1, "session_list": [
                {"session_type":1,"system_msg_type":0,"talker_id":"42","unread_count":2,
                 "session_ts":12345678000000_u64,"last_msg":{"msg_type":1,"timestamp":12345678,"content":"{\"content\":\"你好\"}"}},
                {"session_type":1,"talker_id":35,"session_ts":"12345000000000","is_intercept":1,"is_trust":true},
                {"session_type":1,"system_msg_type":2,"talker_id":66,"session_ts":9007199254740994_u64},
                {"session_type":1,"talker_id":88,"is_intercept":1,"is_trust":0,"session_ts":"9007199254740994"},
                {"session_type":2,"talker_id":34,"session_ts":"9007199254740993"}
            ]
        });
        let mut page = sessions_from(&data, None).unwrap();
        fill_user_cards(
            &mut page.items,
            &json!({"42":{"name":"投稿人","face":"//i0.hdslb.com/face.jpg"}}),
        );
        assert_eq!(page.next_cursor.as_deref(), Some("9007199254740993"));
        assert_eq!(page.items.len(), 2);
        assert_eq!(
            page.items[0],
            DirectSession {
                mid: 42,
                name: "投稿人".into(),
                avatar: "https://i0.hdslb.com/face.jpg".into(),
                preview: "你好".into(),
                at: 12345678,
                unread: 2
            }
        );
        assert_eq!(page.items[1].name, "UID 35");
        assert_eq!(page.items[1].at, 12345000);
        assert_eq!(
            sessions_from(&data, Some(9007199254740993))
                .unwrap()
                .next_cursor,
            None
        );
        let empty = sessions_from(&json!({"session_list":null, "has_more":0}), None).unwrap();
        assert!(empty.items.is_empty() && empty.next_cursor.is_none());
        assert!(sessions_from(&json!({}), None).is_err());
    }

    #[test]
    fn 聊天记录仅保留双方按序显示并保留大整数() {
        let data = json!({"has_more":1,"min_seqno":90,"max_seqno":101,"messages":[
            {"msg_seqno":"101","msg_key":9007199254740999_u64,"receiver_type":1,"receiver_id":6,"sender_uid":2,"msg_type":1},
            {"msg_seqno":"100","msg_key":9007199254740998_u64,"receiver_type":2,"receiver_id":4,"sender_uid":2,"msg_type":1},
            {"msg_seqno":"99","msg_key":"9007199254740997","receiver_type":1,"receiver_id":4,"sender_uid":2,"msg_type":5,
             "content":"9007199254740690","timestamp":7,"sys_cancel":1},
            {"msg_seqno":"98","msg_key":9007199254740996_u64,"receiver_type":1,"receiver_id":"4","sender_uid":"2","msg_type":1,
             "msg_status":1,"content":"{\"content\":\"已经撤回的原文\"}","timestamp":6},
            {"msg_seqno":97,"msg_key":"9007199254740995","receiver_type":1,"receiver_id":2,"sender_uid":4,"msg_type":2,
             "content":"{\"url\":\"http://i0.hdslb.com/test.jpg\"}","timestamp":5}
        ]});
        let page = history_from(&data, 2, 4, None).unwrap();
        assert_eq!(page.next_cursor.as_deref(), Some("90"));
        assert_eq!(page.latest_seqno.as_deref(), Some("99"));
        assert_eq!(page.latest_at, Some(7));
        assert_eq!(page.withdrawals.len(), 1);
        assert_eq!(page.withdrawals[0].target_id, "9007199254740690");
        assert!(page.withdrawals[0].remove);
        assert_eq!(page.items.len(), 2);
        assert_eq!(
            page.items[0],
            DirectMessage {
                id: "9007199254740995".into(),
                sender_mid: 4,
                text: "[图片]".into(),
                image: Some("https://i0.hdslb.com/test.jpg".into()),
                cards: Vec::new(),
                emotes: Vec::new(),
                at: 5
            }
        );
        assert_eq!(page.items[1].id, "9007199254740996");
        assert_eq!(page.items[1].text, "消息已撤回");
        assert_eq!(page.items[1].image, None);
    }

    #[test]
    fn 消息卡片显示标题且未知内容不泄漏原始数据() {
        assert_eq!(
            message_content(&json!({"msg_type":7,"content":{"title":"投稿"}})).0,
            "[分享]投稿"
        );
        assert_eq!(
            message_content(&json!({"msg_type":51,"content":"{\"unknown\":42}"})).0,
            "[此类消息请在哔哩哔哩查看]"
        );
        assert_eq!(
            message_content(&json!({"msg_type":2,"content":{"url":"file:///tmp/test"}})).1,
            None
        );
        let err = direct_error(BiliError::Blocked {
            status: 502,
            head: "聊天原文".into(),
        });
        assert!(!err.to_string().contains("聊天原文"));
    }

    #[test]
    fn 发信保留文字与收件人且需服务端消息编号() {
        let text = "空格 & = \"引号\"\n[doge] ".to_owned();
        let form: HashMap<_, _> = message_form(
            7,
            9,
            1,
            &json!({"content":text}),
            "desktop",
            44,
            "test-csrf".into(),
        )
        .into_iter()
        .collect();
        assert_eq!(form["msg[sender_uid]"], "7");
        assert_eq!(form["msg[receiver_id]"], "9");
        assert_eq!(form["msg[receiver_type]"], "1");
        assert_eq!(form["msg[msg_type]"], "1");
        assert_eq!(form["msg[dev_id]"], "desktop");
        assert_eq!(form["csrf"], "test-csrf");
        assert_eq!(
            serde_json::from_str::<Value>(&form["msg[content]"]).unwrap(),
            json!({"content":text})
        );
        assert!(sent_message(&json!({}), 7, text.clone(), 44).is_err());
        let sent = sent_message(
            &json!({"msg_key":9876543210123456789_u64}),
            7,
            text.clone(),
            44,
        )
        .unwrap();
        assert_eq!(
            sent,
            DirectMessage {
                id: "9876543210123456789".into(),
                sender_mid: 7,
                text,
                image: None,
                cards: Vec::new(),
                emotes: Vec::new(),
                at: 44
            }
        );
    }

    #[test]
    fn 已读只发送指定会话和已显示的序号() {
        let form: HashMap<_, _> = ack_form(7, 9876543210123456789, "test-csrf".into())
            .into_iter()
            .collect();
        assert_eq!(form["talker_id"], "7");
        assert_eq!(form["session_type"], "1");
        assert_eq!(form["ack_seqno"], "9876543210123456789");
        assert_eq!(form["csrf"], "test-csrf");
    }
}
