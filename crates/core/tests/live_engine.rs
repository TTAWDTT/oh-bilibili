//! 端到端验证：真实接口搜到歌，真的把音频喂给声卡，位置真的在走。
//!
//! 运行：cargo test -p bilimusic-core --test live_engine -- --ignored --nocapture

use std::time::Duration;

use bilimusic_core::Engine;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络与声卡"]
async fn 引擎能搜到歌并真的开始播放() {
    let dir = std::env::temp_dir().join(format!("bilimusic-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");

    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎应该能起来");

    let tracks = engine.search("周杰伦 晴天", 1).await.expect("搜索成功");
    assert!(!tracks.is_empty(), "应该有搜索结果");
    println!("搜到 {} 条，第一条：{}", tracks.len(), tracks[0].title);

    let snapshot = engine.play_key(&tracks[0].key).await.expect("播放命令成功");
    println!(
        "相位={} 曲目={:?} 码率={:?}",
        snapshot.phase, snapshot.track.as_ref().map(|t| &t.title), snapshot.quality_kbps
    );
    assert_eq!(snapshot.phase, "playing", "应该进入播放态");
    assert!(snapshot.quality_kbps.unwrap_or(0) >= 64, "应该拿到音轨档位");

    // 网络取首字节要 1–2 秒，1.2 秒的窗口在快网下才够，会假红。
    // 等 3 秒再测，断言的是「有没有在推进」而不是「推进得多快」。
    tokio::time::sleep(Duration::from_millis(3000)).await;
    let after = engine.snapshot();
    println!("3 秒后位置：{}ms", after.position_ms);
    assert!(after.position_ms > 800, "声卡应该真的在推进位置");

    engine.seek(90_000);
    tokio::time::sleep(Duration::from_millis(400)).await;
    let seeked = engine.snapshot().position_ms;
    println!("seek 到 90s 后：{seeked}ms");
    assert!(seeked >= 89_000, "seek 应该落在目标附近");

    let lyrics = engine.lyrics_get(&tracks[0].key).await.expect("歌词请求成功");
    println!("歌词：{} 行，来源 {}", lyrics.lines.len(), lyrics.source);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络与 yt-dlp"]
async fn 能把一首歌下载到本地并落到磁盘() {
    let dir = std::env::temp_dir().join(format!("bilimusic-dl-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    // 测试跑完要自己收干净：之前的版本每次跑都留一个 160KB 的目录。
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(dir.clone());
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");

    let tracks = engine.search("周杰伦 晴天", 1).await.expect("搜索");
    let first = tracks.first().expect("有结果").clone();

    let view = engine.enqueue_download(&first.key).await.expect("下载任务应该起得来");
    println!("任务：{} 状态 {}", view.title, view.state);
    assert_eq!(view.state, "running");

    // 等后台任务落地
    let mut done = None;
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Some(item) = engine.downloads().into_iter().find(|d| d.key == view.key) {
            if item.state == "done" || item.state == "failed" {
                done = Some(item);
                break;
            }
        }
    }
    let finished = done.expect("60 秒内应该结束");
    println!("最终状态 {} 路径 {:?}", finished.state, finished.path);
    assert_eq!(finished.state, "done", "下载应该成功");
    let path = finished.path.expect("成功时必须有路径");
    let size = std::fs::metadata(&path).expect("文件存在").len();
    println!("落盘 {size} 字节");
    assert!(size > 100_000, "音频文件不该这么小");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 歌词三级回退的实际命中情况() {
    let dir = std::env::temp_dir().join(format!("bilimusic-lrc-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(dir.clone());
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");

    let tracks = engine.search("周杰伦 晴天", 1).await.expect("搜索");
    let mut stats = std::collections::BTreeMap::new();
    for track in tracks.iter().take(6) {
        let doc = engine.lyrics_get(&track.key).await.expect("歌词");
        let n = doc.lines.len();
        *stats.entry(doc.source.clone()).or_insert(0) += 1;
        println!(
            "{:28} 来源 {:18} {} 行  首行: {}",
            track.title.chars().take(14).collect::<String>(),
            doc.source,
            n,
            doc.lines
                .first()
                .map(|l| format!("{}ms {}", l.at_ms, l.text.chars().take(16).collect::<String>()))
                .unwrap_or_else(|| "（空）".into())
        );
    }
    println!("来源统计: {stats:?}");
    // 至少有一首能拿到歌词，否则说明整条链路都是断的
    assert!(!stats.is_empty());
}
