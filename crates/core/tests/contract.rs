//! 契约漂移防线。
//!
//! Rust 侧改了字段名而 TS 没跟上，编译器和类型检查都不会报错，只会在运行时静默变成
//! undefined。这个测试把两边钉在一起：Rust 序列化出来的每个键，TS 契约里必须出现。

use std::collections::BTreeSet;
use std::path::Path;

use bilimusic_core::wire::{AppEvent, PlayerSnapshot, QueueView, WireError};
use bilimusic_model::{Millis, Track, TrackKey};

fn contract() -> String {
    let path = Path::new("../../apps/desktop/src/shared/lib/contract.ts");
    std::fs::read_to_string(path).expect("读不到 contract.ts，测试要在 workspace 根跑")
}

/// 递归收集所有出现过的键。只看顶层的旧版本漏掉了嵌套 Track 里的 `duration`，
/// 于是界面拿到的时长恒为空，测试还是绿的。
fn keys_of(value: &serde_json::Value) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    collect(value, &mut out);
    out
}

fn collect(value: &serde_json::Value, out: &mut BTreeSet<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                out.insert(k.clone());
                collect(v, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect(item, out);
            }
        }
        _ => {}
    }
}

/// 抽出 contract.ts 里某个对象类型声明的字段名集合。
fn ts_fields(ts: &str, type_name: &str) -> BTreeSet<String> {
    let start = ts
        .find(&format!("export type {type_name} = {{"))
        .unwrap_or_else(|| panic!("contract.ts 里找不到 {type_name}"));
    let rest = &ts[start..];
    let end = rest.find('}').expect("类型声明没有闭合");
    rest[..end]
        .lines()
        .filter_map(|line| {
            let name = line.trim().split(':').next()?.trim();
            let name = name.trim_end_matches('?');
            name.chars()
                .next()
                .filter(|c| c.is_ascii_alphabetic())
                .map(|_| name.to_string())
        })
        .filter(|n| !n.starts_with("export"))
        .collect()
}

fn sample_track() -> Track {
    Track {
        key: TrackKey::from_provider("BV1xx411c7mD"),
        title: "晴天".into(),
        artist: "周杰伦".into(),
        duration: Some(Millis(269_000)),
        cover: Some("https://example.com/c.jpg".into()),
        accent: None,
        views: Some(1000),
        danmaku: Some(10),
        up_avatar: Some("https://i0.hdslb.com/x.jpg".into()),
        up_mid: Some(1234),
        tname: Some("音乐".into()),
        typeid: Some(3),
        pages: Some(8),
    }
}

#[test]
fn 播放快照的字段_ts_侧都有() {
    let snapshot = PlayerSnapshot {
        page: None,
        mode: bilimusic_core::wire::PlayMode::Listen,
        phase: "playing".into(),
        track: Some(sample_track()),
        local: false,
        position_ms: 1000,
        duration_ms: 269_000,
        volume: 0.7,
        speed: 1.0,
        repeat: "off".into(),
        shuffle: false,
        quality_kbps: Some(192),
    };
    let value = serde_json::to_value(&snapshot).expect("可序列化");
    let declared = ts_fields(&contract(), "PlayerSnapshot");
    // 只看顶层：嵌套的 Track 由下面那条专门的测试负责。
    let top: std::collections::BTreeSet<String> = value
        .as_object()
        .expect("对象")
        .keys()
        .cloned()
        .collect();
    let missing: Vec<&String> = top.difference(&declared).collect();
    assert!(missing.is_empty(), "PlayerSnapshot 缺字段：{missing:?}");
}

#[test]
fn 曲目的字段名两边完全一致() {
    let value = serde_json::to_value(sample_track()).expect("可序列化");
    let rust_keys = keys_of(&value);
    let ts_keys = ts_fields(&contract(), "Track");
    let missing: Vec<&String> = rust_keys.difference(&ts_keys).collect();
    let extra: Vec<&String> = ts_keys.difference(&rust_keys).collect();
    assert!(
        missing.is_empty(),
        "Rust 发这些键但 TS 没声明：{missing:?}（界面会读不到值）"
    );
    assert!(
        extra.is_empty(),
        "TS 声明这些键但 Rust 从不发：{extra:?}（界面永远拿到 undefined）"
    );
}

#[test]
fn 队列视图的字段_ts_侧都有() {
    let view = QueueView {
        items: vec![sample_track()],
        index: Some(0),
    };
    let value = serde_json::to_value(&view).expect("可序列化");
    let declared = ts_fields(&contract(), "QueueView");
    let top: std::collections::BTreeSet<String> = value
        .as_object()
        .expect("对象")
        .keys()
        .cloned()
        .collect();
    let missing: Vec<&String> = top.difference(&declared).collect();
    assert!(missing.is_empty(), "QueueView 缺字段：{missing:?}");
}

#[test]
fn 下载视图的字段_ts_侧都有() {
    let view = bilimusic_core::engine::DownloadView {
        key: "BV1".into(),
        title: "晴天".into(),
        state: "done".into(),
        progress: 1.0,
        path: Some("/tmp/晴天.m4a".into()),
        error: None,
    };
    let value = serde_json::to_value(&view).expect("可序列化");
    let declared = ts_fields(&contract(), "DownloadView");
    let top: std::collections::BTreeSet<String> = value
        .as_object()
        .expect("对象")
        .keys()
        .cloned()
        .collect();
    let missing: Vec<&String> = top.difference(&declared).collect();
    assert!(missing.is_empty(), "DownloadView 缺字段：{missing:?}");
}

#[test]
fn 事件类型标签_ts_联合里有() {
    let ts = contract();
    let events = [
        AppEvent::Progress {
            position_ms: 0,
            duration_ms: 0,
            level: 0.0,
            sent_at_ms: 0,
        },
        AppEvent::NowPlaying {
            track: sample_track(),
            index: None,
        },
        AppEvent::Buffering {
            track: sample_track(),
        },
        AppEvent::Stopped,
        AppEvent::LibraryChanged,
    ];
    for event in events {
        let value = serde_json::to_value(&event).expect("可序列化");
        let tag = value["type"].as_str().expect("事件必须有 type 标签");
        assert!(
            ts.contains(&format!("'{tag}'")),
            "Rust 发出事件 `{tag}`，但 contract.ts 的 AppEvent 联合里没有"
        );
    }
}

#[test]
fn 错误的类名_ts_侧都有() {
    let ts = contract();
    let errors = [
        WireError::Retryable {
            message: "x".into(),
            retry_after_ms: None,
        },
        WireError::RateLimited {
            message: "x".into(),
            retry_after_ms: 1,
        },
        WireError::NeedsLogin { message: "x".into() },
        WireError::Input {
            message: "x".into(),
            field: None,
        },
        WireError::Internal { message: "x".into() },
    ];
    for error in errors {
        let value = serde_json::to_value(&error).expect("可序列化");
        let class = value["class"].as_str().expect("错误必须有 class");
        assert!(
            ts.contains(&format!("'{class}'")),
            "Rust 的错误类 `{class}` 没进 contract.ts 的 ErrorClass 联合"
        );
    }
}
