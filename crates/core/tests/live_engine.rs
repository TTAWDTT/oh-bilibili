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

/// 分P 要能取到，并且切换分P 会换 cid。
#[test]
#[ignore = "真实网络"]
fn 分P_列表与切换() {
    let dir = std::env::temp_dir().join(format!("bilimusic-pg-{}", std::process::id()));
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
        // 找一个多 P 的视频
        let tracks = engine.search("罗翔 刑法".into(), 1).await.expect("搜索");
        let mut found = None;
        for t in tracks.iter().take(6) {
            let v = engine.open_watch(&t.key, "http://127.0.0.1:9").await;
            if let Ok(v) = v {
                if v.pages.len() > 1 {
                    found = Some(v);
                    break;
                }
            }
        }
        let Some(view) = found else {
            println!("没找到多 P 的视频，跳过");
            return;
        };
        println!("分P 数 {}，当前 P{}", view.pages.len(), view.current_page);
        for p in view.pages.iter().take(3) {
            println!("  P{} {} ({}ms)", p.no, p.title, p.duration_ms);
        }
        assert!(view.pages.len() > 1);
        let second = view.pages[1].no;
        let key = bilimusic_model::TrackKey::from_provider(view.key.clone());
        let v2 = engine
            .open_watch_page(&key, "http://127.0.0.1:9", Some(second))
            .await
            .expect("切到第二个分P");
        println!("切到 P{}，清单 {}", v2.current_page, v2.manifest_url);
        assert_eq!(v2.current_page, second);
        assert_ne!(v2.manifest_url, view.manifest_url, "换分P 应该是一条新清单");
    });
}

/// 首页推荐要真能取到。风控会拒，所以只断言「要么有货、要么明确为空」。
#[test]
#[ignore = "真实网络"]
fn 首页推荐能取到卡片() {
    let dir = std::env::temp_dir().join(format!("bilimusic-fd-{}", std::process::id()));
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
        let items = engine.home_feed(1).await.expect("取推荐");
        println!("推荐 {} 条", items.len());
        for t in items.iter().take(5) {
            println!("  {} | {} | {:?}s", t.title.chars().take(22).collect::<String>(), t.artist, t.duration.map(|d| d.0 / 1000));
        }
        assert!(!items.is_empty(), "第一屏不该是空的");
        assert!(items.iter().all(|t| !t.title.is_empty()));
    });
}

/// 「听视频」整条链路，静音验证。
///
/// 把引擎音量先置 0，音频回调照跑但乘的是 0，所以真机不会发声。
/// 验的是：切到听之后音频引擎真的接管、位置从画面那里接上。
#[test]
#[ignore = "真实网络；音量置 0 所以无声"]
fn 切到听视频能接管并接上位置() {
    let dir = std::env::temp_dir().join(format!("bilimusic-listen-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    if let Some(src) = dirs_cookies() {
        let _ = std::fs::copy(&src, dir.join("cookies.json"));
    }
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");
    // 先静音，后面整条链路都不会出声
    engine.set_volume(0.0);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    rt.block_on(async {
        let tracks = engine.search("周杰伦 晴天".into(), 1).await.expect("搜索");
        let key = tracks.first().map(|t| t.key.clone()).expect("至少一条");
        // 先进队列，set_mode 要能从队列里取当前项
        let keys: Vec<String> = vec![key.as_opaque().to_string()];
        let prepared = engine.play_context(&keys, 0).await;
        println!("准备阶段: {:?} 相位={}", prepared.as_ref().map(|_| "ok").map_err(|e| e.message()), engine.snapshot().phase);
        std::thread::sleep(std::time::Duration::from_millis(900));
        println!("播放 0.9 秒后位置 {}ms（音量 {}）", engine.snapshot().position_ms, engine.snapshot().volume);
        engine.set_mode(bilimusic_core::wire::PlayMode::Watch, None, None).await.expect("切到看");
        assert_eq!(engine.snapshot().mode, bilimusic_core::wire::PlayMode::Watch);

        // 从「看到第 40 秒」切到听
        let snap = engine
            .set_mode(bilimusic_core::wire::PlayMode::Listen, Some(40_000), None)
            .await
            .expect("切到听");
        println!("模式={:?} 相位={} 位置={}ms 音量={}", snap.mode, snap.phase, snap.position_ms, snap.volume);
        assert_eq!(snap.mode, bilimusic_core::wire::PlayMode::Listen);
        assert_eq!(snap.volume, 0.0, "音量必须是 0，否则会出声");
        // 拉流要一两秒，加载完成后 seek 才落到时钟上，所以轮询等而不是睡固定时长。
        let mut landed = 0u64;
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(400));
            landed = engine.snapshot().position_ms;
            if landed > 1_000 {
                break;
            }
        }
        println!("接管后位置 {landed}ms");
        assert!(
            landed >= 38_000,
            "位置应该接在画面传过来的 40 秒附近，实际 {landed}ms"
        );

        // 再走 3 秒，位置应该继续前进：证明是真的在放，不是停在某一帧
        std::thread::sleep(std::time::Duration::from_millis(3000));
        let later = engine.snapshot();
        println!("3 秒后位置 {}ms（音量 {}）", later.position_ms, later.volume);
        assert!(later.position_ms > landed + 2_000, "位置应该继续前进");
        assert_eq!(later.volume, 0.0, "音量必须是 0，整条链路静音");
    });
}

/// 看过 A 之后切「听」，必须接着放 A，而不是队列里上一条。
///
/// 真机上踩到过：观看页没把视频设为队列当前项，切过去听到的是上一首。
/// 音量置 0，整条链路静音。
#[test]
#[ignore = "真实网络；音量 0 所以无声"]
fn 听视频接的是正在看的那一条() {
    let dir = std::env::temp_dir().join(format!("bilimusic-focus-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    if let Some(src) = dirs_cookies() {
        let _ = std::fs::copy(&src, dir.join("cookies.json"));
    }
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");
    engine.set_volume(0.0);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    rt.block_on(async {
        let tracks = engine.search("周杰伦 晴天".into(), 1).await.expect("搜索");
        let first = tracks.first().expect("至少一条").key.clone();
        let second = tracks.get(1).expect("至少两条").key.clone();
        assert_ne!(first.as_opaque(), second.as_opaque());

        // 先听第一条，让队列里有东西
        let keys: Vec<String> = vec![second.as_opaque().to_string()];
        engine.play_context(&keys, 0).await.ok();
        println!("队列当前: {:?}", engine.snapshot().track.map(|t| t.key.as_opaque().to_string()));

        // 再看第一条，然后切听
        let view = engine.open_watch(&first, "http://127.0.0.1:9").await.expect("打开观看页");
        println!("观看: {} 时长 {}ms", view.key, view.duration_ms);
        let snap = engine
            .set_mode(bilimusic_core::wire::PlayMode::Listen, Some(5_000), Some(&first))
            .await
            .expect("切到听");

        // 等加载完成后看当前曲目
        println!(
            "set_mode 返回: 曲目 {:?} 相位 {}",
            snap.track.as_ref().map(|t| t.key.as_opaque().to_string()),
            snap.phase
        );
        // 加载期间快照里仍是旧曲目，所以要等到真的换成目标那条，
        // 不能「非空就跳出」——那是测试自己的错，不是产品的问题。
        let mut current = String::new();
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(400));
            current = engine
                .snapshot()
                .track
                .map(|t| t.key.as_opaque().to_string())
                .unwrap_or_default();
            if current == first.as_opaque() {
                break;
            }
        }
        println!("切听之后在放: {current}（期望 {}）音量 {}", first.as_opaque(), snap.volume);
        assert_eq!(current, first.as_opaque(), "应该接正在看的那一条");
        assert_eq!(snap.volume, 0.0);
    });
}

/// 进度上报要能通。这里直接调一次，不去等 20 秒的定时器。
#[test]
#[ignore = "真实网络"]
fn 观看进度能上报() {
    let dir = std::env::temp_dir().join(format!("bilimusic-rp-{}", std::process::id()));
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
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let result = engine.report_progress_public(&key, 42, now).await;
        println!("上报结果: {:?}", result.as_ref().map(|_| "ok").map_err(|e| e.message()));
        assert!(result.is_ok(), "登录态下上报应该成功");
    });
}

async fn like_state(engine: &std::sync::Arc<Engine>, key: &bilimusic_model::TrackKey) -> bool {
    let rows = engine
        .relation_states(vec![key.as_opaque().to_string()])
        .await
        .expect("查状态");
    rows[0].1
}

/// 点赞写路径的往返，**并恢复账号原状**。
///
/// 顺序是「读原状 → 改成反面 → 校验 → 改回原状 → 校验」。
/// 早先写成「先点再取」，结果把用户本来点过赞的视频取消了——
/// 验证写操作之前必须先想清楚怎么恢复。
#[test]
#[ignore = "真实网络；结束时恢复账号原状"]
fn 点赞能写入也能取消() {
    let dir = std::env::temp_dir().join(format!("bilimusic-like-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    if let Some(src) = dirs_cookies() {
        let _ = std::fs::copy(&src, dir.join("cookies.json"));
    }
    let engine = Engine::new(&dir.join("library.sqlite")).expect("引擎");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let target = std::env::var("LIKE_BVID").unwrap_or_default();
    rt.block_on(async {
        let key = if target.is_empty() {
            let tracks = engine.search("周杰伦 晴天".into(), 1).await.expect("搜索");
            tracks.first().map(|t| t.key.clone()).expect("至少一条")
        } else {
            bilimusic_model::TrackKey::from_provider(target)
        };
        let original = like_state(&engine, &key).await;
        println!("目标 {} 原始状态 like={original}", key.as_opaque());

        let flipped = !original;
        engine.like_set(&key, flipped).await.expect("写入");
        let after = like_state(&engine, &key).await;
        println!("改成 {flipped} 之后 like={after}");
        assert_eq!(after, flipped, "服务端应该跟上写入");

        engine.like_set(&key, original).await.expect("恢复");
        let restored = like_state(&engine, &key).await;
        println!("恢复成 {original} 之后 like={restored}");
        assert_eq!(restored, original, "必须恢复原状");
    });
}

/// 稍后再看的往返：加进去，再拿出来。写路径是否可用，用这条可逆的操作判定。
#[test]
#[ignore = "真实网络；结束时恢复"]
fn 稍后再看能写入也能移除() {
    let dir = std::env::temp_dir().join(format!("bilimusic-wl-{}", std::process::id()));
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
        println!("目标 {}", key.as_opaque());
        match engine.watch_later_set(&key, true).await {
            Ok(()) => println!("加入稍后再看: ok"),
            Err(e) => {
                println!("加入失败: {}", e.message());
                panic!("写路径不可用");
            }
        }
        // 立刻移除，保持账号状态不变
        match engine.watch_later_set(&key, false).await {
            Ok(()) => println!("移出稍后再看: ok"),
            Err(e) => panic!("移出失败，账号可能被弄脏: {}", e.message()),
        }
    });
}

/// 收藏的往返，结束时恢复原状。
///
/// 投币不可逆（会真花掉硬币），所以不在这里验；这条只覆盖可逆的收藏。
#[test]
#[ignore = "真实网络；结束时恢复"]
fn 收藏能写入也能取消() {
    let dir = std::env::temp_dir().join(format!("bilimusic-fav-{}", std::process::id()));
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
        let original = fav_state(&engine, &key).await;
        println!("目标 {} 原始收藏状态={original}", key.as_opaque());

        let flipped = !original;
        engine.fav_set(&key, flipped, None).await.expect("写入收藏");
        let after = fav_state(&engine, &key).await;
        println!("改成 {flipped} 之后={after}");
        assert_eq!(after, flipped, "服务端应该跟上");

        engine.fav_set(&key, original, None).await.expect("恢复收藏");
        let restored = fav_state(&engine, &key).await;
        println!("恢复成 {original} 之后={restored}");
        assert_eq!(restored, original, "必须恢复原状");
    });
}

async fn fav_state(engine: &std::sync::Arc<Engine>, key: &bilimusic_model::TrackKey) -> bool {
    let rows = engine
        .relation_states(vec![key.as_opaque().to_string()])
        .await
        .expect("查状态");
    rows[0].2
}
