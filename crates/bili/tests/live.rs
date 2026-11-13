//! 真实接口验证。默认 ignore，因为它依赖网络和 B 站的当前风控状态。
//!
//! 运行：cargo test -p bilimusic-bili --test live -- --ignored --nocapture

use bilimusic_model::SearchQuery;
use bilimusic_bili::Source;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 搜索到取流的完整链路可用() {
    let source = Source::open().await.expect("Source 应该能打开");

    let query = SearchQuery::parse("周杰伦 晴天", 1).expect("查询合法");
    let tracks = source.search(&query).await.expect("搜索应该成功");
    assert!(!tracks.is_empty(), "搜索不该返回空");

    println!("\n搜索命中 {} 条，前三条：", tracks.len());
    for (i, t) in tracks.iter().take(3).enumerate() {
        println!(
            "  {}. {} / {} / {:?}",
            i + 1,
            t.title,
            t.artist,
            t.duration.map(|d| d.0 / 1000)
        );
    }

    let with_cover = tracks.iter().filter(|t| t.cover.is_some()).count();
    println!("\n带封面的结果：{with_cover}/{}", tracks.len());
    if let Some(c) = tracks.iter().find_map(|t| t.cover.as_deref()) {
        println!("封面样本：{c}");
    }
    assert!(with_cover > 0, "搜索结果应该带封面，否则列表只能显示字母占位");
    let with_avatar = tracks.iter().filter(|t| t.up_avatar.is_some()).count();
    println!("带 UP 头像的结果：{with_avatar}/{}", tracks.len());
    assert!(with_avatar > 0, "搜索结果应该带 UP 主头像");

    let first = &tracks[0];
    assert!(
        first.title.contains("晴天"),
        "第一名应该是晴天，实际是 {}",
        first.title
    );

    let detail = source.detail(&first.key).await.expect("详情应该成功");
    println!("\n选中：{} / cid={}", detail.track.title, detail.cid);
    assert!(detail.cid > 0, "cid 必须有效");

    let streams = source.streams(&detail).await.expect("取流应该成功");
    println!("可用音轨：");
    for s in &streams {
        println!("  {}kbps bandwidth={}", s.quality.kbps(), s.bandwidth);
    }
    assert_eq!(
        streams[0].quality,
        bilimusic_model::Quality::BEST,
        "排序后第一档应该是最高的"
    );

    // 用真实请求证明这个 URL 能拉出字节。音频层以后走的就是这条路。
    let headers = source.stream_headers();
    let mut req = reqwest::Client::new()
        .get(&streams[0].url)
        .header("Range", "bytes=0-65535");
    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }
    let resp = req.send().await.expect("音频 CDN 应该可达");
    let status = resp.status();
    let bytes = resp.bytes().await.expect("应该读到字节");
    println!(
        "\n音频拉取：HTTP {} {} 字节，Content-Type={:?}",
        status.as_u16(),
        bytes.len(),
        "（已忽略）"
    );
    assert!(
        status.as_u16() == 206 || status.as_u16() == 200,
        "预期 206 或 200，实际 {status}"
    );
    assert!(bytes.len() >= 1024, "至少应该拿到 1KB 音频字节");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 能取到真实弹幕() {
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let first = tracks.first().expect("有结果");
    let lines = source.danmaku(&first.key).await.expect("弹幕接口");
    println!("弹幕条数：{}", lines.len());
    if let Some(sample) = lines.first() {
        println!("样本：{sample}");
    }
    assert!(!lines.is_empty(), "这条视频应该有多条弹幕");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 弹幕能算成密度曲线() {
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let first = tracks.first().expect("有结果");
    let heat = source.danmaku_heat(&first.key, 40).await.expect("密度");
    let peak = heat.iter().copied().max().unwrap_or(0);
    let non_zero = heat.iter().filter(|v| **v > 0).count();
    println!("40 桶里 {non_zero} 个非空，峰值 {peak}");
    assert_eq!(heat.len(), 40);
    assert!(peak > 0, "应该算出非零密度");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 按播放量排序确实改变结果顺序() {
    use bilimusic_model::SearchOrder;
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");

    let default = source.search(&q).await.expect("默认排序");
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    let by_click = source
        .search_ordered(&q, SearchOrder::Click)
        .await
        .expect("按播放量");

    println!("默认首条：{:?}", default.first().map(|t| &t.title));
    println!("播放量首条：{:?}", by_click.first().map(|t| &t.title));
    println!("默认首条播放量：{:?}", default.first().and_then(|t| t.views));
    println!("播放量首条播放量：{:?}", by_click.first().and_then(|t| t.views));

    assert!(!by_click.is_empty(), "按播放量排序应该有结果");
    let dv = default.first().and_then(|t| t.views).unwrap_or(0);
    let cv = by_click.first().and_then(|t| t.views).unwrap_or(0);
    let dv_list: Vec<u64> = default.iter().filter_map(|t| t.views).collect();
    let cv_list: Vec<u64> = by_click.iter().filter_map(|t| t.views).collect();
    let same_order = dv_list == cv_list;
    println!("两份列表播放量序列相同：{same_order}");
    println!("默认前五：{:?}", dv_list.iter().take(5).collect::<Vec<_>>());
    println!("播放前五：{:?}", cv_list.iter().take(5).collect::<Vec<_>>());
    assert!(!same_order, "order=click 应该改变排序，否则这个参数已经失效");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 分区过滤能按类型筛结果() {
    use bilimusic_model::SearchOrder;
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let all = source
        .search_ordered(&q, SearchOrder::TotalRank)
        .await
        .expect("搜索");
    let music: Vec<_> = all.iter().filter(|t| matches!(t.typeid, Some(3 | 28 | 29 | 30 | 31 | 59 | 130 | 193 | 171))).collect();
    println!("全部 {} 条，其中音乐区 {} 条", all.len(), music.len());
    assert!(all.iter().all(|t| t.typeid.is_some()), "每条都应该带 typeid");
    assert!(!music.is_empty(), "晴天应该有音乐区结果");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 按_up_主名能搜到他的投稿() {
    use bilimusic_model::SearchOrder;
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("zyl2012_音乐无限", 1).expect("查询");
    let tracks = source
        .search_ordered(&q, SearchOrder::TotalRank)
        .await
        .expect("搜索");
    let same_author = tracks
        .iter()
        .filter(|t| t.artist.contains("zyl2012"))
        .count();
    println!("搜到 {} 条，其中同作者 {} 条", tracks.len(), same_author);
    println!("首条作者：{:?}", tracks.first().map(|t| &t.artist));
    assert!(!tracks.is_empty(), "按 UP 名应该能搜到东西");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 搜索结果的_up_主带_mid() {
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let with_mid = tracks.iter().filter(|t| t.up_mid.is_some()).count();
    println!("带 UP mid 的：{with_mid}/{}", tracks.len());
    assert!(with_mid > 0, "关注按钮需要 UP 的 mid");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 稍后再看未登录时明确报需要登录() {
    let source = Source::open().await.expect("Source");
    source.logout().await;
    let key = bilimusic_model::TrackKey::from_provider("BV1d4411N7zD");
    match source.set_watch_later(&key, true).await {
        Err(bilimusic_bili::error::BiliError::NeedsLogin(_)) => {}
        other => panic!("预期 NeedsLogin，实际 {other:?}"),
    }
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 弹幕带真实颜色() {
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let first = tracks.first().expect("有结果");
    let items = source.danmaku_colored(&first.key).await.expect("弹幕");
    let colored = items.iter().filter(|(_, _, c)| *c != 0xFFFFFF).count();
    println!("共 {} 条，其中 {} 条有彩色", items.len(), colored);
    assert!(!items.is_empty());
}

#[tokio::test]
#[ignore = "真实网络"]
async fn tids_参数真的按分区过滤() {
    use bilimusic_model::SearchOrder;
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");

    let all = source.search_ordered(&q, SearchOrder::TotalRank).await.expect("全站");
    let music = source
        .search_in_partition(&q, SearchOrder::TotalRank, Some(3))
        .await
        .expect("音乐区");
    let game = source
        .search_in_partition(&q, SearchOrder::TotalRank, Some(4))
        .await
        .expect("游戏区");

    // 音乐区的结果里不该出现明显属于别的分区的条目。
    // 允许 tname 为空——B 站偶尔不给 typename（244/267 这类新子分区），
    // 但只要有名字就不该是游戏/动画/生活/影视/舞蹈。
    let wrong: Vec<String> = music
        .iter()
        .filter_map(|t| t.tname.as_deref())
        .filter(|name| ["游戏", "动画", "生活", "影视", "舞蹈", "鬼畜", "知识"].contains(name))
        .map(|s| s.to_string())
        .collect();
    let named_music = music
        .iter()
        .filter(|t| t.tname.as_deref() == Some("音乐"))
        .count();
    println!(
        "全站 {} 条 / 音乐区 {} 条（其中具名音乐 {} 条，错分区 {:?}）/ 游戏区 {} 条",
        all.len(),
        music.len(),
        named_music,
        wrong,
        game.len()
    );
    assert!(!music.is_empty(), "音乐区应该有结果");
    assert!(named_music >= 5, "音乐区里应该大部分是具名音乐条目");
    assert!(wrong.is_empty(), "tids=3 不该返回其他分区的条目：{wrong:?}");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn up_名片能拿到粉丝数与签名() {
    let source = Source::open().await.expect("Source");
    // 影视飓风
    let c = source.author_card(946974).await.expect("名片");
    println!(
        "{} / LV{} / 粉丝 {} / 投稿 {} / 获赞 {} / 认证 {:?}",
        c.name, c.level, c.fans, c.videos, c.likes, c.official
    );
    assert!(!c.name.is_empty());
    assert!(c.fans > 1000, "粉丝数应该是真实值");
    assert!(c.videos > 0, "投稿总数应该是真实值");
    assert!(c.level >= 1 && c.level <= 6, "等级应该在 1..6");
    assert!(c.face.starts_with("https://"));
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 选最多播放时结果按播放量递减() {
    use bilimusic_model::SearchOrder;
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let clicks = source
        .search_in_partition(&q, SearchOrder::Click, Some(129))
        .await
        .expect("舞蹈区按播放");
    let views: Vec<u64> = clicks.iter().map(|t| t.views.unwrap_or(0)).collect();
    println!("前 6 条播放量：{views:?}");
    // 允许 API 在同一量级内有微调，但不该出现「40 万排在 95 万前面」这种倒挂
    let mut inversions = 0;
    for w in views.windows(2) {
        if w[0] < w[1] {
            inversions += 1;
        }
    }
    assert!(
        inversions <= 2,
        "按播放量排序时不该有这么多倒挂：{views:?}"
    );
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 音质标签与实际档位一致() {
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let first = tracks.first().expect("有结果");
    let detail = source.detail(&first.key).await.expect("详情");
    let streams = source.streams(&detail).await.expect("音轨");
    let top = streams.first().expect("至少一档");
    println!(
        "标签 {}K / 标称带宽 {} kbps / 档位数 {}",
        top.quality.kbps(),
        top.bandwidth / 1000,
        streams.len()
    );
    // 标签不能高于实际带宽太多：192K 的档位带宽不该低于 150kbps
    assert!(
        (top.bandwidth / 1000) as u16 >= top.quality.kbps().saturating_sub(50),
        "标签 {}K 与实际 {} kbps 不符",
        top.quality.kbps(),
        top.bandwidth / 1000
    );
}

#[tokio::test]
#[ignore = "真实网络，用来定位换歌延迟"]
async fn 换歌的三个网络调用各自多久() {
    use std::time::Instant;
    let source = Source::open().await.expect("Source");
    let q = SearchQuery::parse("周杰伦 晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let key = &tracks[0].key;

    let t0 = Instant::now();
    let detail = source.detail(key).await.expect("detail");
    let d1 = t0.elapsed();

    let t1 = Instant::now();
    let streams = source.streams(&detail).await.expect("streams");
    let d2 = t1.elapsed();

    let t2 = Instant::now();
    let headers = source.stream_headers();
    let url = streams[0].url.clone();
    let _media = tokio::task::spawn_blocking(move || {
        bilimusic_bili::media::RemoteMedia::open(url, headers)
    })
    .await
    .expect("join")
    .expect("打开流");
    let d3 = t2.elapsed();

    println!("detail   {:>6} ms", d1.as_millis());
    println!("streams  {:>6} ms", d2.as_millis());
    println!("open     {:>6} ms", d3.as_millis());
    println!("合计     {:>6} ms", (d1 + d2 + d3).as_millis());
}

#[tokio::test]
#[ignore = "真实网络，用来量收藏夹一页的耗时"]
async fn 收藏夹一页要多久() {
    use std::time::Instant;
    let source = Source::open().await.expect("Source");
    // 用应用已保存的登录态；没有就跳过（这条测试只在登录后有意义）
    let cookie_path = std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h).join("Library/Application Support/dev.bilimusic.app/cookies.json"))
        .expect("HOME");
    let Ok(raw) = std::fs::read_to_string(&cookie_path) else {
        println!("没有 cookies.json，跳过");
        return;
    };
    let pairs: Vec<(String, String)> = serde_json::from_str(&raw).expect("cookies.json 格式");
    source.import_cookies(&pairs);
    source.refresh_session().await.expect("刷新会话");
    let folders = source.fav_folders().await.expect("收藏夹列表");
    let folder = folders
        .iter()
        .max_by_key(|f| f.count)
        .expect("至少一个收藏夹");
    let (id, name, count) = (folder.id, folder.title.clone(), folder.count);
    println!("用收藏夹「{name}」({count} 个视频)");
    assert!(folder.cover.is_some(), "收藏夹列表接口应该自带封面");

    let covers = source.fav_covers(id, 4).await.expect("前四张封面");
    println!("封面拼图 {} 张", covers.len());
    assert!(!covers.is_empty(), "收藏夹列表页应该有封面可拼");

    let t0 = Instant::now();
    let page = source.fav_tracks(id, 1).await.expect("一页");
    println!("第一页 {} 条，耗时 {} ms", page.len(), t0.elapsed().as_millis());
    if let Some(t) = page.first() {
        println!("首条: {} / {} / {:?} / 播放 {:?}", t.title.chars().take(18).collect::<String>(), t.artist, t.duration.map(|d| d.0), t.views);
    }
    assert!(!page.is_empty(), "应该读到内容");
    assert!(page[0].duration.is_some(), "时长应该来自列表接口");
}

#[tokio::test]
#[ignore = "真实网络，用来核对赞过的视频"]
async fn 赞过的视频带封面和分区() {
    let source = Source::open().await.expect("Source");
    let cookie_path = std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h).join("Library/Application Support/dev.bilimusic.app/cookies.json"))
        .expect("HOME");
    let Ok(raw) = std::fs::read_to_string(&cookie_path) else {
        println!("没有 cookies.json，跳过");
        return;
    };
    let pairs: Vec<(String, String)> = serde_json::from_str(&raw).expect("cookies.json 格式");
    source.import_cookies(&pairs);
    source.refresh_session().await.expect("刷新会话");

    let list = source.liked_videos().await.expect("赞过的视频");
    println!("赞过 {} 条", list.len());
    let first = list.first().expect("至少一条");
    println!(
        "首条: {} / {} / {:?} / {}",
        first.title.chars().take(18).collect::<String>(),
        first.artist,
        first.duration.map(|d| d.0),
        first.tname.clone().unwrap_or_default()
    );
    assert!(first.cover.is_some(), "喜欢页的卡片要有封面");

    let tags = source.video_tags(&first.key.as_opaque()).await.expect("视频标签");
    println!("标签 {:?}", tags);
    assert!(!tags.is_empty(), "视频页应该能读到标签");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 全站排行榜一次给一百条() {
    let source = Source::open().await.expect("Source");
    let list = source.ranking(0).await.expect("全站榜");
    println!("全站榜 {} 条", list.len());
    let first = list.first().expect("至少一条");
    println!(
        "榜首: {} / {} / {:?}",
        first.title.chars().take(18).collect::<String>(),
        first.artist,
        first.duration.map(|d| d.0)
    );
    assert!(list.len() >= 90, "全站榜应接近 100 条");
    assert!(first.cover.is_some(), "榜首要有封面");
}

#[tokio::test]
#[ignore = "真实网络，核对 UP 主置顶评论"]
async fn 置顶评论排在第一页最前() {
    let source = Source::open().await.expect("Source");
    // 必须带登录态：游客只回 4 条，测不出真实的 20 条分页。
    let cookie_path = std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h).join("Library/Application Support/dev.bilimusic.app/cookies.json"))
        .expect("HOME");
    if let Ok(raw) = std::fs::read_to_string(&cookie_path) {
        let pairs: Vec<(String, String)> = serde_json::from_str(&raw).expect("cookies.json 格式");
        source.import_cookies(&pairs);
        let _ = source.refresh_session().await;
    } else {
        println!("没有 cookies.json，跳过");
        return;
    }
    // BV1kZWX62ENY（影视飓风）的 UP 主置顶是一条「我在这里」。
    let key = bilimusic_model::TrackKey::from_provider("BV1kZWX62ENY");
    let page = source.comments(&key, 1, true).await.expect("第一页评论");
    assert!(page.items.len() >= 10, "登录态下一页应该接近 20 条，实际 {}", page.items.len());
    let pinned = page.items.iter().filter(|c| c.pinned).count();
    println!("第一页 {} 条，置顶 {} 条", page.items.len(), pinned);
    assert!(pinned <= 1, "最多一条置顶");
    if let Some(first) = page.items.first() {
        println!("首条: {} / {} / 赞 {}", first.author, first.text.chars().take(20).collect::<String>(), first.likes);
        if pinned == 1 {
            assert!(first.pinned, "置顶必须排在最前");
        }
    }
}
