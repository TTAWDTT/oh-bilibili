//! 真实声卡验证：加载一段真实音轨，看位置是否被回调推进。
//!
//! 这些测试**会通过扬声器放声音**，所以在 CI 与任何安静场合都必须跳过。
//! 只有显式设置 `BILIMUSIC_AUDIO_TESTS=1` 才会真正执行：
//!
//! ```sh
//! BILIMUSIC_AUDIO_TESTS=1 cargo test -p bilimusic-audio --test playback -- --nocapture
//! ```

use std::time::Duration;

use bilimusic_audio::{Media, Player};

/// 没有显式开启就直接跳过，避免在开会/深夜等场合突然出声。
fn audio_tests_enabled() -> bool {
    std::env::var("BILIMUSIC_AUDIO_TESTS").is_ok_and(|v| v == "1")
}

#[test]
fn 解码结束后时钟仍播完缓冲() {
    if !audio_tests_enabled() {
        eprintln!("跳过：未设置 BILIMUSIC_AUDIO_TESTS=1（这个测试会出声）");
        return;
    }
    let path = std::path::Path::new("../../testdata/sample.m4s");
    if !path.exists() {
        eprintln!("跳过：没有 testdata/sample.m4s");
        return;
    }
    let Ok(player) = Player::start() else {
        eprintln!("跳过：当前环境打不开输出设备");
        return;
    };

    player.set_volume(0.0);
    let file = std::fs::File::open(path).expect("fixture 可读");
    player.load(Media::new(file)).expect("加载成功");

    let started = std::time::Instant::now();
    while !player.is_started() && started.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(player.is_started(), "声卡应该先输出首批样本");

    player.seek(315_000);
    let seeked = std::time::Instant::now();
    while player.clock().position_ms() < 314_000 && seeked.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(20));
    }

    let deadline = std::time::Instant::now();
    let mut ended = false;
    while deadline.elapsed() < Duration::from_secs(8) {
        if player.take_ended() {
            ended = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let at_end = player.clock().position_ms();
    println!("自然结束后位置：{at_end}ms");
    assert!(ended, "应该报自然结束");
    assert!(
        at_end > 316_000,
        "结束必须等缓冲播完，不能在解码 EOF 处丢尾巴，实际 {at_end}ms"
    );
}

#[test]
fn 加载前暂停不会在加载后自己起播() {
    if !audio_tests_enabled() {
        eprintln!("跳过：未设置 BILIMUSIC_AUDIO_TESTS=1（这个测试会出声）");
        return;
    }
    let path = std::path::Path::new("../../testdata/sample.m4s");
    if !path.exists() {
        eprintln!("跳过：没有 testdata/sample.m4s");
        return;
    }
    let Ok(player) = Player::start() else {
        eprintln!("跳过：当前环境打不开输出设备");
        return;
    };

    player.set_volume(0.0);
    player.pause();
    let file = std::fs::File::open(path).expect("fixture 可读");
    player.load(Media::new(file)).expect("加载成功");
    std::thread::sleep(Duration::from_millis(700));

    assert!(!player.clock().is_playing(), "加载后不应自动解除暂停");
    assert!(!player.is_started(), "暂停时不应消费首批样本");
    assert_eq!(player.clock().position_ms(), 0);

    player.play();
    let deadline = std::time::Instant::now();
    while !player.is_started() && deadline.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(player.is_started(), "恢复后应该开始输出样本");
}

#[test]
fn 尾部缓冲暂停后仍能继续播完() {
    if !audio_tests_enabled() {
        eprintln!("跳过：未设置 BILIMUSIC_AUDIO_TESTS=1（这个测试会出声）");
        return;
    }
    let path = std::path::Path::new("../../testdata/sample.m4s");
    if !path.exists() {
        eprintln!("跳过：没有 testdata/sample.m4s");
        return;
    }
    let Ok(player) = Player::start() else {
        eprintln!("跳过：当前环境打不开输出设备");
        return;
    };

    player.set_volume(0.0);
    let file = std::fs::File::open(path).expect("fixture 可读");
    player.load(Media::new(file)).expect("加载成功");
    let started = std::time::Instant::now();
    while !player.is_started() && started.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(player.is_started(), "声卡应该先输出首批样本");

    player.seek(315_000);
    std::thread::sleep(Duration::from_millis(100));
    player.pause();
    assert!(!player.peek_ended(), "尾部缓冲还没排空时不能报结束");

    std::thread::sleep(Duration::from_millis(300));
    player.play();
    let deadline = std::time::Instant::now();
    let mut ended = false;
    while deadline.elapsed() < Duration::from_secs(8) {
        if player.take_ended() {
            ended = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let at_end = player.clock().position_ms();
    println!("尾部暂停恢复后结束位置：{at_end}ms");
    assert!(ended, "恢复后应该播完尾部并报结束");
    assert!(at_end > 316_000, "尾部暂停不能丢缓冲，实际 {at_end}ms");
}

#[test]
fn 播放时位置由声卡推进() {
    if !audio_tests_enabled() {
        eprintln!("跳过：未设置 BILIMUSIC_AUDIO_TESTS=1（这个测试会出声）");
        return;
    }
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
    if !audio_tests_enabled() {
        eprintln!("跳过：未设置 BILIMUSIC_AUDIO_TESTS=1（这个测试会出声）");
        return;
    }
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
