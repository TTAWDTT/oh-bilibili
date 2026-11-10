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

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络，用来量歌词耗时"]
async fn 歌词要多久() {
    use std::time::Instant;
    let dir = std::env::temp_dir().join(format!("bilimusic-lrc-t-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
    let _c = Cleanup(dir.clone());
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");
    let tracks = engine.search("周杰伦 晴天", 1).await.expect("搜索");
    for track in tracks.iter().take(4) {
        let t0 = Instant::now();
        let doc = engine.lyrics_get(&track.key).await.expect("歌词");
        println!(
            "{:>6} ms  {:16} {:3} 行  {}",
            t0.elapsed().as_millis(),
            doc.source,
            doc.lines.len(),
            track.title.chars().take(14).collect::<String>()
        );
    }
}

/// 连续两次打开同一首，慢的那次不许把状态弄坏。
///
/// 修之前 fetch_and_load 收下 token 却没用（`let _ = token;`），
/// 解析完照样把字节塞给声卡，还会把状态置成 faulted。
#[tokio::test]
#[ignore]
async fn 连续两次打开不会把状态打成失败() {
    let dir = std::env::temp_dir().join(format!("bilimusic-race-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎应该能起来");
    let found = engine.search("晴天 周杰伦".into(), 1).await.expect("搜索");
    let key = found.first().map(|t| t.key.clone()).expect("至少一条结果");

    let a = engine.clone();
    let b = engine.clone();
    let _ = (&a, &b);
    let ka = key.clone();
    let kb = key;
    let (ra, rb) = tokio::join!(a.play_key(&ka), b.play_key(&kb));
    println!("第一次: {:?}", ra.as_ref().map(|_| "ok").map_err(|e| e.message()));
    println!("第二次: {:?}", rb.as_ref().map(|_| "ok").map_err(|e| e.message()));

    let snap = engine.snapshot();
    println!("最终状态: {:?}", snap.phase);
    assert_ne!(
        format!("{:?}", snap.phase),
        "Faulted",
        "两次打开交错之后不该停在失败态"
    );
}

fn dirs_cookies() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let p = std::path::PathBuf::from(home)
        .join("Library/Application Support/dev.bilimusic.app/cookies.json");
    p.exists().then_some(p)
}

/// 观看页的数据链路要能跑通：拿到 DASH 视频轨，合成只含视频的 MPD，
/// 铸出句柄，再从句柄换回清单。全程不出声。
///
/// 用同步测试再自己建 runtime：Engine::new 在带登录态时会刷新 nav，
/// 而它内部会 block_on 一个新 runtime，放进 tokio::test 里会直接 panic。
#[test]
#[ignore = "真实网络"]
fn 观看页能拿到只含视频的清单() {
    let dir = std::env::temp_dir().join(format!("bilimusic-watch-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    match dirs_cookies() {
        Some(src) => {
            std::fs::copy(&src, dir.join("cookies.json")).expect("复制登录态");
            println!("已带入登录态");
        }
        None => println!("没有找到本机登录态，画质会退到未登录档位"),
    }

    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");

    rt.block_on(async {
        let tracks = engine.search("周杰伦 晴天".into(), 1).await.expect("搜索");
        let key = tracks.first().map(|t| t.key.clone()).expect("至少一条");

        let view = engine.open_watch(&key, "http://127.0.0.1:9").await.expect("打开观看页");
        println!(
            "句柄={} 时长={}ms 档位={}",
            view.manifest_url, view.duration_ms, view.qualities.len()
        );
        for q in view.qualities.iter().take(5) {
            println!("  {} {}x{} id={}", q.label, q.width, q.height, q.id);
        }
        assert!(!view.qualities.is_empty(), "应该有画质档位");
        assert!(view.qualities[0].height >= 720, "最高档不该低于 720P");

        let handle = view.manifest_url.rsplit('/').next().expect("清单地址末尾是句柄");
        let payload = engine.redeem_stream(handle).expect("句柄能换回清单");
        let bilimusic_core::tickets::Payload::Doc(xml) = payload else {
            panic!("清单应该是本机文本，不是远端地址");
        };
        println!("清单长度 {} 字节", xml.len());
        assert!(xml.contains("contentType=\"video\""));
        assert!(!xml.contains("contentType=\"audio\""), "清单里不该有音频轨");
        assert!(!xml.contains("bilivideo"), "远端地址不该出现在清单里");
        assert!(xml.contains("http://127.0.0.1:9/m/t"), "清单里的地址应该是本机代理的绝对地址");
    });
}

/// 弹幕要真能取到。
///
/// 这条测试存在的原因：x/v1/dm/list.so 改成返回 HTML 之后取数一直是空的，
/// 而界面只在 mock 里验过动画，所以「0 条弹幕」很久没被发现。
#[test]
#[ignore = "真实网络"]
fn 弹幕能取到真实数据() {
    let dir = std::env::temp_dir().join(format!("bilimusic-dm-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    if let Some(src) = dirs_cookies() {
        let _ = std::fs::copy(&src, dir.join("cookies.json"));
    }
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    rt.block_on(async {
        let tracks = engine.search("周杰伦 晴天".into(), 1).await.expect("搜索");
        let key = tracks.first().map(|t| t.key.clone()).expect("至少一条");
        let list = engine.danmaku_colored(&key).await.expect("取弹幕");
        println!("共 {} 条弹幕", list.len());
        for (at, text, color) in list.iter().take(3) {
            println!("  {at:.1}s  {text}  #{color:06x}");
        }
        assert!(list.len() > 50, "一条视频动辄上千条，实际只有 {}", list.len());
        assert!(list.iter().any(|(_, t, _)| !t.is_empty()), "文本不该全空");
    });
}

/// 评论区要真能取到数据。用真接口，不用 mock。
#[test]
#[ignore = "真实网络"]
fn 评论能取到真实数据与嵌套回复() {
    let dir = std::env::temp_dir().join(format!("bilimusic-cm-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    if let Some(src) = dirs_cookies() {
        let _ = std::fs::copy(&src, dir.join("cookies.json"));
    }
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    rt.block_on(async {
        let tracks = engine.search("周杰伦 晴天".into(), 1).await.expect("搜索");
        let key = tracks.first().map(|t| t.key.clone()).expect("至少一条");
        let page = engine.comments(&key, 1).await.expect("取评论");
        println!("总数 {} 条，本页 {} 条，还有更多={}", page.total, page.items.len(), page.has_more);
        for c in page.items.iter().take(3) {
            println!("  {} 赞{}  {} 字", c.author, c.likes, c.text.chars().count());
            for r in c.replies.iter().take(1) {
                println!("     └ {}: {}", r.author, r.text.chars().count());
            }
        }
        assert!(page.total > 0, "真实视频应该有评论");
        assert!(!page.items.is_empty(), "本页不该是空的");
        assert!(page.items.iter().any(|c| !c.text.is_empty()), "文本不该全空");
        assert!(page.has_more, "24 万条的视频第一页之后应该还有");

        // 第二页必须真的换了一批，而不是把第一页再发一次
        let second = engine.comments(&key, 2).await.expect("取第 2 页");
        println!("第 2 页 {} 条", second.items.len());
        assert_eq!(second.page, 2);
        assert!(!second.items.is_empty(), "第 2 页不该是空的");
        let first_ids: Vec<&str> = page.items.iter().map(|c| c.id.as_str()).collect();
        assert!(
            second.items.iter().all(|c| !first_ids.contains(&c.id.as_str())),
            "第 2 页不该重复第 1 页的评论"
        );
    });
}
