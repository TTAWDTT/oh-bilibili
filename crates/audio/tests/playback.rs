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
