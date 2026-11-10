//! 真实声卡验证：加载一段真实音轨，看位置是否被回调推进。
//! 没有输出设备时跳过，不让 CI 红。

use std::time::Duration;

use bilimusic_audio::{Media, Player};

#[test]
fn 播放时位置由声卡推进() {
    let path = std::path::Path::new("../../testdata/sample.m4s");
    if !path.exists() {
        eprintln!("跳过：没有 testdata/sample.m4s");
        return;
    }
    let Ok(player) = Player::start() else {
        eprintln!("跳过：当前环境打不开输出设备");
        return;
    };

    let file = std::fs::File::open(path).expect("fixture 可读");
    player.load(Media::new(file)).expect("加载成功");
    std::thread::sleep(Duration::from_millis(700));

    let pos = player.clock().position_ms();
    println!(
        "播放 700ms 后位置：{pos}ms，设备采样率 {}",
        player.device_rate()
    );
    assert!(pos > 80, "位置应该前进，实际 {pos}ms");

    player.seek(60_000);
    std::thread::sleep(Duration::from_millis(300));
    let after = player.clock().position_ms();
    println!("seek 到 60000ms 后：{after}ms");
    assert!(
        after >= 59_000,
        "seek 之后位置应该落在目标附近，实际 {after}ms"
    );
}

/// 时钟必须跟得上真实时间。
///
/// 这是「音画不同步」的根：位置慢于墙钟，歌词就会越来越落后于声音。
/// 实测出现过 20 秒墙钟只推进 16 秒（慢 21%）的情况。
#[test]
fn 位置推进速度等于真实时间() {
    let path = std::path::Path::new("../../testdata/sample.m4s");
    if !path.exists() {
        eprintln!("跳过：没有 testdata/sample.m4s");
        return;
    }
    let Ok(player) = Player::start() else {
        eprintln!("跳过：当前环境打不开输出设备");
        return;
    };

    let file = std::fs::File::open(path).expect("fixture 可读");
    player.load(Media::new(file)).expect("加载成功");
    std::thread::sleep(Duration::from_millis(800)); // 让缓冲先充满

    let p0 = player.clock().position_ms();
    let t0 = std::time::Instant::now();
    std::thread::sleep(Duration::from_millis(3000));
    let p1 = player.clock().position_ms();
    let wall = t0.elapsed().as_millis() as u64;

    let advanced = p1 - p0;
    let ratio = advanced as f64 / wall as f64;
    println!("墙钟 {wall}ms / 位置 {advanced}ms / 比值 {ratio:.3}");

    // 允许 ±8%：声卡缓冲与调度会有抖动，但绝不该差 20%
    assert!(
        (0.92..=1.08).contains(&ratio),
        "位置推进速度应与真实时间一致，实际比值 {ratio:.3}"
    );
}
