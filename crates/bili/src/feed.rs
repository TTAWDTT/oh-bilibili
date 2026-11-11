//! 首页推荐。
//!
//! 这是全站风控最严的接口，所以每次只取一屏，失败就返回空列表让界面
//! 显示「换一批」，不做后台预取、不重试。

use bilimusic_model::{Millis, Track, TrackKey};

/// 从 `wbi/index/top/feed/rcmd` 的响应里取卡片。
///
/// 字段是视频卡片形状，与搜索结果不完全一致，所以单独解析。
pub fn items_from(value: &serde_json::Value) -> Vec<Track> {
    let Some(list) = value["data"]["item"].as_array() else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|v| {
            let bvid = v["bvid"].as_str().filter(|s| !s.is_empty())?;
            let title = crate::search::strip_tags(v["title"].as_str().unwrap_or(""));
            if title.is_empty() {
                return None;
            }
            let duration = v["duration"].as_u64();
            Some(Track {
                key: TrackKey::from_provider(bvid),
                title,
                artist: v["owner"]["name"].as_str().unwrap_or("").to_string(),
                duration: duration.map(|s| Millis(s * 1000)),
                cover: {
                    let pic = v["pic"].as_str().unwrap_or("");
                    let fixed = pic.replacen("http://", "https://", 1);
                    (!fixed.is_empty()).then_some(fixed)
                },
                accent: None,
                views: v["stat"]["view"].as_u64(),
                danmaku: v["stat"]["danmaku"].as_u64(),
                up_avatar: v["owner"]["face"]
                    .as_str()
                    .map(|f| f.replacen("http://", "https://", 1)),
                up_mid: v["owner"]["mid"].as_u64(),
                tname: v["tname"].as_str().map(|s| s.to_string()),
                typeid: None,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 解析出卡片与时长() {
        let raw = serde_json::json!({
            "code": 0,
            "data": { "item": [
                { "bvid": "BV1xx", "title": "<em>标题</em>测试", "duration": 213,
                  "pic": "http://i0.hdslb.com/a.jpg",
                  "owner": { "name": "UP", "mid": 42, "face": "http://i0.hdslb.com/f.jpg" },
                  "stat": { "view": 1234, "danmaku": 56 }, "tname": "音乐" },
                { "bvid": "", "title": "没有 bvid 应该被丢掉" },
                { "bvid": "BV1yy", "title": "" }
            ] }
        });
        let items = items_from(&raw);
        assert_eq!(items.len(), 1);
        let t = &items[0];
        assert_eq!(t.key.as_opaque(), "BV1xx");
        assert_eq!(t.title, "标题测试");
        assert_eq!(t.duration, Some(Millis(213_000)));
        assert_eq!(t.cover.as_deref(), Some("https://i0.hdslb.com/a.jpg"));
        assert_eq!(t.up_mid, Some(42));
        assert_eq!(t.up_avatar.as_deref(), Some("https://i0.hdslb.com/f.jpg"));
        assert_eq!(t.views, Some(1234));
    }

    #[test]
    fn 风控返回时给空列表() {
        let items = items_from(&serde_json::json!({ "code": -352, "message": "风控校验失败" }));
        assert!(items.is_empty());
    }
}
