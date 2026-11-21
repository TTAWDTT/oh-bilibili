//! 删除下载项的两种意图：只删记录不碰磁盘，确认删除才删文件。
//!
//! 复用真实的 SQLite 与真实 Engine：界面看到的状态来自启动时的磁盘快照，
//! 而文件可以在同一会话里被放回或替换。

use std::path::{Path, PathBuf};

use bilimusic_core::Engine;
use bilimusic_model::{Track, TrackKey};
use bilimusic_store::Library;

struct Fixture {
    dir: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("时钟")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "bilimusic-download-remove-{tag}-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        Self { dir }
    }

    fn db(&self) -> PathBuf {
        self.dir.join("library.sqlite")
    }

    fn seed(&self, key: &str, path: &Path) {
        let library = Library::open(&self.db()).expect("打开库");
        library
            .save_download(
                &track(key),
                Some(path.to_str().expect("路径是 UTF-8")),
                "done",
                None,
            )
            .expect("写下载记录");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn track(key: &str) -> Track {
    Track {
        key: TrackKey::from_provider(key),
        title: format!("歌 {key}"),
        artist: "某人".into(),
        duration: None,
        cover: None,
        accent: None,
        views: None,
        danmaku: None,
        up_avatar: None,
        up_mid: None,
        tname: None,
        typeid: None,
    }
}

fn stored_keys(fixture: &Fixture) -> Vec<String> {
    Library::open(&fixture.db())
        .expect("打开库")
        .downloads()
        .expect("读下载记录")
        .into_iter()
        .map(|record| record.key.as_opaque().to_string())
        .collect()
}

#[test]
fn 始终缺失的条目只移除记录() {
    let fixture = Fixture::new("missing");
    let audio = fixture.dir.join("始终缺失 [BV1aa411c7m1].m4a");
    fixture.seed("BV1aa411c7m1", &audio);

    let engine = Engine::new(&fixture.db()).expect("引擎");
    let item = engine.downloads().into_iter().next().expect("有一条记录");
    assert_eq!(item.state, "missing");
    assert!(!audio.exists());

    engine
        .download_remove_record("BV1aa411c7m1")
        .expect("只移除记录不该报错");
    assert!(engine.downloads().is_empty());
    assert!(!audio.exists());
    assert!(stored_keys(&fixture).is_empty());
}

#[test]
fn 原文件被放回后只移除记录保留文件() {
    let fixture = Fixture::new("restored");
    let audio = fixture.dir.join("放回 [BV1bb411c7m2].m4a");
    fixture.seed("BV1bb411c7m2", &audio);

    let engine = Engine::new(&fixture.db()).expect("引擎");
    let item = engine.downloads().into_iter().next().expect("有一条记录");
    assert_eq!(item.state, "missing");

    // 同一次会话里把原文件放回原路径，界面仍停留在启动时的 missing。
    std::fs::write(&audio, b"original audio").expect("放回文件");
    engine
        .download_remove_record("BV1bb411c7m2")
        .expect("只移除记录");

    assert_eq!(
        std::fs::read(&audio).expect("文件应该还在"),
        b"original audio"
    );
    assert!(engine.downloads().is_empty());
    assert!(stored_keys(&fixture).is_empty());
}

#[test]
fn 同名文件替换后只移除记录保留文件() {
    let fixture = Fixture::new("replaced");
    let audio = fixture.dir.join("替换 [BV1cc411c7m3].m4a");
    fixture.seed("BV1cc411c7m3", &audio);

    let engine = Engine::new(&fixture.db()).expect("引擎");
    let item = engine.downloads().into_iter().next().expect("有一条记录");
    assert_eq!(item.state, "missing");

    std::fs::write(&audio, b"another file with the same name").expect("写入同名文件");
    engine
        .download_remove_record("BV1cc411c7m3")
        .expect("只移除记录");

    assert_eq!(
        std::fs::read(&audio).expect("同名文件应该还在"),
        b"another file with the same name"
    );
    assert!(engine.downloads().is_empty());
    assert!(stored_keys(&fixture).is_empty());
}

#[test]
fn 确认删除音频才删掉文件() {
    let fixture = Fixture::new("delete");
    let present = fixture.dir.join("在盘上 [BV1dd411c7m4].m4a");
    let absent = fixture.dir.join("已缺失 [BV1ee411c7m5].m4a");
    std::fs::write(&present, b"audio").expect("准备文件");
    fixture.seed("BV1dd411c7m4", &present);
    fixture.seed("BV1ee411c7m5", &absent);

    let engine = Engine::new(&fixture.db()).expect("引擎");
    assert_eq!(engine.downloads().len(), 2);

    engine
        .download_delete_audio("BV1dd411c7m4")
        .expect("删除在盘文件");
    assert!(!present.exists(), "确认删除后文件应该消失");

    engine
        .download_delete_audio("BV1ee411c7m5")
        .expect("文件已缺失也应该能删掉记录");
    assert!(engine.downloads().is_empty());
    assert!(stored_keys(&fixture).is_empty());
}
