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

    tokio::time::sleep(Duration::from_millis(1200)).await;
    let after = engine.snapshot();
    println!("1.2 秒后位置：{}ms", after.position_ms);
    assert!(after.position_ms > 200, "声卡应该真的在推进位置");

    engine.seek(90_000);
    tokio::time::sleep(Duration::from_millis(400)).await;
    let seeked = engine.snapshot().position_ms;
    println!("seek 到 90s 后：{seeked}ms");
    assert!(seeked >= 89_000, "seek 应该落在目标附近");

    let lyrics = engine.lyrics_get(&tracks[0].key).await.expect("歌词请求成功");
    println!("歌词：{} 行，来源 {}", lyrics.lines.len(), lyrics.source);
}
