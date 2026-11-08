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

fn keys_of(value: &serde_json::Value) -> BTreeSet<String> {
    match value {
        serde_json::Value::Object(map) => map.keys().cloned().collect(),
        _ => BTreeSet::new(),
    }
}

fn sample_track() -> Track {
    Track {
        key: TrackKey::from_provider("BV1xx411c7mD"),
        title: "晴天".into(),
        artist: "周杰伦".into(),
        duration: Some(Millis(269_000)),
        cover: Some("https://example.com/c.jpg".into()),
        accent: None,
    }
}

#[test]
fn 播放快照的字段_ts_侧都有() {
    let snapshot = PlayerSnapshot {
        phase: "playing".into(),
        track: Some(sample_track()),
        position_ms: 1000,
        duration_ms: 269_000,
        volume: 0.7,
        repeat: "off".into(),
        shuffle: false,
        quality_kbps: Some(192),
    };
    let value = serde_json::to_value(&snapshot).expect("可序列化");
    let ts = contract();
    for key in keys_of(&value) {
        assert!(
            ts.contains(&format!("{key}:")),
            "Rust 序列化出 `{key}`，但 contract.ts 里没有同名字段"
        );
    }
}

#[test]
fn 队列视图的字段_ts_侧都有() {
    let view = QueueView {
        items: vec![sample_track()],
        index: Some(0),
    };
    let value = serde_json::to_value(&view).expect("可序列化");
    let ts = contract();
    for key in keys_of(&value) {
        assert!(ts.contains(&format!("{key}:")), "contract.ts 缺字段 `{key}`");
    }
}

#[test]
fn 事件类型标签_ts_联合里有() {
    let ts = contract();
    let events = [
        AppEvent::Progress {
            position_ms: 0,
            duration_ms: 0,
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
