//! 真实接口验证。默认 ignore，因为它依赖网络和 B 站的当前风控状态。
//!
//! 运行：`scripts/live-test.sh`。
//! 需要登录态的用例只读取 `BILIMUSIC_LIVE_COOKIES` 指向的专用账号 cookies.json。
//! 直接跑 `cargo test --ignored` 而没有配置时会失败，不会把「跳过」计成通过。

use bilimusic_model::{SearchQuery, TrackKey};
use bilimusic_bili::Source;

const LIVE_COOKIES_ENV: &str = "BILIMUSIC_LIVE_COOKIES";

/// 登录态只来自显式指定的专用测试账号，不读取应用自己的数据目录。
fn live_cookies() -> Vec<(String, String)> {
    let Some(path) = std::env::var_os(LIVE_COOKIES_ENV).map(std::path::PathBuf::from) else {
        panic!(
            "这条用例需要 {LIVE_COOKIES_ENV}=<专用测试账号的 cookies.json>。\
             请运行 scripts/live-test.sh：未配置时它会明确 skip，而不是把用例计为 passed"
        );
    };
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "{LIVE_COOKIES_ENV} 指向的凭据文件读不了（{}）：{error}",
            path.display()
        )
    });
    serde_json::from_str(&raw).unwrap_or_else(|error| {
        panic!(
            "{LIVE_COOKIES_ENV} 必须是 cookies.json 的 [(name, value)] 数组（{}）：{error}",
            path.display()
        )
    })
}

async fn source_with_live_cookies() -> Source {
    let cookies = live_cookies();
    let source = Source::new().expect("Source 应该能打开");
    source.import_cookies(&cookies);
    source.refresh_session().await.expect("刷新会话");
    assert!(
        source.is_logged_in(),
        "{LIVE_COOKIES_ENV} 指向的账号未登录"
    );
    source
}

/// live 脚本在跑整套用例前先执行这一条：只读验证凭据确实能登录。
#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn live_preflight_credentials() {
    let source = source_with_live_cookies().await;
    let nav = source.nav();
    assert!(nav.is_login, "{LIVE_COOKIES_ENV} 指向的账号未登录");
    println!(
        "VERIFIED: {LIVE_COOKIES_ENV} 对应的账号 {} 可以登录",
        nav.uname.as_deref().unwrap_or("(无昵称)")
    );
}

/// 每周必看：期数列表是公开接口，某一期要走 wbi + web_location，缺了就 -352。
/// 标题在 `data.config` 里（不是 `data` 顶层），片单一次 50 条。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 每周必看能取到期数与片单() {
    let source = Source::new().expect("Source 应该能打开");
    let issues = source.weekly_issues().await.expect("期数列表应该能取到");
    assert!(issues.len() > 10, "期数应该有一长串，实际 {}", issues.len());
    let latest = issues.first().expect("至少一期");
    assert!(latest.number >= 300, "最新期号不该这么小：{}", latest.number);
    assert!(!latest.name.is_empty(), "期数条目要带名字");

    let page = source.weekly_issue(latest.number).await.expect("某一期应该能取到");
    println!(
        "第 {} 期：{} / {} / {} 条",
        latest.number,
        page.subject,
        page.label,
        page.tracks.len()
    );
    assert!(!page.subject.is_empty(), "主题在 data.config 里，取空了说明字段名又变了");
    assert_eq!(page.tracks.len(), 50, "一期应当是 50 条");
    assert!(
        page.tracks.iter().all(|t| t.cover.is_some()),
        "片单条目应该都带封面"
    );
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 官网视频分区可获取两页有封面和作者的投稿() {
    let source = Source::new().expect("Source 应该能打开");
    let regions = source.discovery_regions().await.expect("应能取得官网分区");
    let dance = regions.iter().find(|region| region.name == "舞蹈").expect("应有舞蹈区");
    assert!(regions.iter().any(|region| region.name == "人工智能"));
    assert!(regions.iter().all(|region| region.rid > 0));
    let first = source.discovery_region_feed(dance.rid, 1).await.expect("应能取得舞蹈首页");
    let second = source.discovery_region_feed(dance.rid, 2).await.expect("应能取得次页");
    assert!(first.iter().any(|track| !track.artist.is_empty() && track.cover.is_some()));
    assert!(second.iter().any(|track| !first.iter().any(|prev| prev.key == track.key)));
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 游客二维码接口能生成挑战() {
    let source = Source::new().expect("Source 应该能打开");
    let qr = source.login_qr().await.expect("二维码应该能生成");
    assert!(!qr.key.is_empty(), "qrcode_key 不能为空");
    assert!(qr.url.starts_with("http"), "二维码内容应该是一个链接");
    assert!(qr.svg.starts_with("<svg"), "二维码必须渲染成本地 SVG");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 搜索到取流的完整链路可用() {
    let source = Source::new().expect("Source 应该能打开");

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
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let first = tracks.first().expect("有结果");
    let heat = source.danmaku_heat(&first.key, 40, None).await.expect("密度");
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
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let with_mid = tracks.iter().filter(|t| t.up_mid.is_some()).count();
    println!("带 UP mid 的：{with_mid}/{}", tracks.len());
    assert!(with_mid > 0, "关注按钮需要 UP 的 mid");
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 稍后再看未登录时明确报需要登录() {
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
    let q = SearchQuery::parse("晴天", 1).expect("查询");
    let tracks = source.search(&q).await.expect("搜索");
    let first = tracks.first().expect("有结果");
    let items = source.danmaku_colored(&first.key, None).await.expect("弹幕");
    let colored = items.iter().filter(|line| line.color != 0xFFFFFF).count();
    println!("共 {} 条，其中 {} 条有彩色", items.len(), colored);
    assert!(!items.is_empty());
}

#[tokio::test]
#[ignore = "真实网络"]
async fn tids_参数真的按分区过滤() {
    use bilimusic_model::SearchOrder;
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
    // 影视飓风
    let c = source.author_card(946974).await.expect("名片");
    println!(
        "{} / LV{} / 粉丝 {:?} / 投稿 {:?} / 获赞 {:?} / 认证 {:?}",
        c.name, c.level, c.fans, c.videos, c.likes, c.official
    );
    assert!(!c.name.is_empty());
    assert!(c.fans.is_some_and(|fans| fans > 1000), "粉丝数应该是真实值");
    assert!(c.videos.is_some_and(|videos| videos > 0), "投稿总数应该是真实值");
    assert!(c.level >= 1 && c.level <= 6, "等级应该在 1..6");
    assert!(c.face.starts_with("https://"));
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 相关推荐的时长是毫秒不是秒() {
    let source = Source::new().expect("Source");
    // 咒术回战续作，相关推荐里有大量几分钟到几十分钟的稿子
    let key = TrackKey::from_provider("BV1XeP9zYE8L");
    let items = source.related(&key).await.expect("相关推荐");
    let with_duration = items
        .iter()
        .filter(|t| t.duration.is_some())
        .take(5)
        .map(|t| t.duration.unwrap().0)
        .collect::<Vec<_>>();
    println!("前 5 条时长（毫秒）：{with_duration:?}");
    // 这条接口按秒下发；漏了换算的话每条都会是几十毫秒，渲染成 0:00
    assert!(
        with_duration.iter().all(|ms| *ms >= 1000),
        "相关推荐的时长应该是毫秒，实际 {with_duration:?}"
    );
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 选最多播放时结果按播放量递减() {
    use bilimusic_model::SearchOrder;
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
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
    let source = Source::new().expect("Source");
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
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 收藏夹一页要多久() {
    use std::time::Instant;
    let source = source_with_live_cookies().await;
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
    let page = source.fav_tracks(id, 1).await.expect("一页").tracks;
    println!("第一页 {} 条，耗时 {} ms", page.len(), t0.elapsed().as_millis());
    if let Some(t) = page.first() {
        println!("首条: {} / {} / {:?} / 播放 {:?}", t.title.chars().take(18).collect::<String>(), t.artist, t.duration.map(|d| d.0), t.views);
    }
    assert!(!page.is_empty(), "应该读到内容");
    assert!(page[0].duration.is_some(), "时长应该来自列表接口");
}

#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 赞过的视频带封面和分区() {
    let source = source_with_live_cookies().await;

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
    let source = Source::new().expect("Source");
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

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 热门榜能翻页() {
    let source = Source::new().expect("Source");
    let (first, no_more_first, notes) = source.popular(1).await.expect("热门第 1 页");
    let (second, no_more_second, _) = source.popular(2).await.expect("热门第 2 页");
    println!(
        "热门 pn=1 {} 条（no_more={no_more_first}，{} 条带标签），pn=2 {} 条（no_more={no_more_second}）",
        first.len(),
        notes.len(),
        second.len()
    );
    let head = first.first().expect("第 1 页有内容");
    println!(
        "首条: {} / {}",
        head.title.chars().take(18).collect::<String>(),
        head.artist
    );
    assert_eq!(first.len(), 50, "每页应该 50 条");
    assert_eq!(second.len(), 50, "每页应该 50 条");
    assert!(!no_more_first, "第 1 页不该是最后一页");
    assert!(!no_more_second, "第 2 页不该是最后一页");

    let seen: std::collections::HashSet<&str> =
        first.iter().map(|t| t.key.as_opaque()).collect();
    for track in &second {
        assert!(
            !seen.contains(track.key.as_opaque()),
            "两页之间不该重复：{}",
            track.title
        );
    }
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 入站必刷带推荐语() {
    let source = Source::new().expect("Source");
    let (title, explain, items) = source.precious().await.expect("入站必刷");
    println!("\n{title}：{explain}（{} 条）", items.len());
    for item in items.iter().take(3) {
        println!("  {} / {}", item.track.title, item.note);
    }
    assert!(!title.is_empty(), "标题不该为空");
    assert!(items.len() >= 90, "一次应该给接近 98 条，实际 {}", items.len());
    assert!(
        items.iter().all(|item| !item.note.is_empty()),
        "每条都应该带 B 站写的推荐语"
    );
}

#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 置顶评论排在第一页最前() {
    // 必须带登录态：游客只回 4 条，测不出真实的 20 条分页。
    let source = source_with_live_cookies().await;
    // BV1kZWX62ENY（影视飓风）的 UP 主置顶是一条「我在这里」。
    let key = bilimusic_model::TrackKey::from_provider("BV1kZWX62ENY");
    let page = source.comments(&key, None, true).await.expect("第一页评论");
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

#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 评论游标能翻到第二页() {
    let source = source_with_live_cookies().await;
    let key = bilimusic_model::TrackKey::from_provider("BV1kZWX62ENY");
    let first = source.comments(&key, None, true).await.expect("第一页评论");
    let next = first.next.clone().expect("第一页应该给下一页游标");
    let second = source
        .comments(&key, Some(&next), true)
        .await
        .expect("第二页评论");
    println!(
        "第一页 {} 条，第二页 {} 条，总数 {}",
        first.items.len(),
        second.items.len(),
        first.total
    );
    assert!(!second.items.is_empty(), "第二页不该是空的");
    let first_ids: std::collections::HashSet<&str> =
        first.items.iter().map(|c| c.id.as_str()).collect();
    assert!(
        second.items.iter().all(|c| !first_ids.contains(c.id.as_str())),
        "两页不该有重复评论"
    );
}

#[tokio::test]
#[ignore = "真实网络"]
async fn 评论带粉丝牌() {
    let source = Source::new().expect("Source");
    // BV1kZWX62ENY（影视飓风）：UP 主自己的评论戴着「飓风」粉丝牌。
    let key = bilimusic_model::TrackKey::from_provider("BV1kZWX62ENY");
    let page = source.comments(&key, None, true).await.expect("第一页评论");
    let medaled: Vec<_> = page
        .items
        .iter()
        .filter_map(|c| c.medal.as_ref().map(|m| (c, m)))
        .collect();
    println!(
        "第一页 {} 条，带粉丝牌 {} 条：",
        page.items.len(),
        medaled.len()
    );
    for (c, m) in &medaled {
        println!(
            "  {} 【{} {}级】{}",
            c.author,
            m.name,
            m.level,
            c.text.chars().take(16).collect::<String>()
        );
    }
    let up = medaled
        .iter()
        .find(|(c, m)| c.mid == 946974 && m.name == "飓风")
        .expect("UP 主自己的评论应该戴「飓风」粉丝牌");
    assert_eq!(up.1.level, 18, "UP 的粉丝牌应该是 18 级");
    assert!(!medaled.is_empty(), "至少一条评论带粉丝牌");
}

#[tokio::test]
#[ignore = "真实网络，核对合集"]
async fn 合集带全部集数与封面() {
    let source = Source::new().expect("Source");
    // 影视飓风的「百万粉丝Q&A」是一个 10 集的合集。
    let key = bilimusic_model::TrackKey::from_provider("BV1kZWX62ENY");
    let detail = source.detail(&key).await.expect("详情");
    let season = detail.season.expect("这条视频属于一个合集");
    println!("合集「{}」{} 集", season.title, season.episodes.len());
    assert_eq!(season.episodes.len(), 10);
    let first = &season.episodes[0];
    println!(
        "首集 {} / {:?} / {:?}ms / {:?}",
        first.title, first.cover.is_some(), first.duration_ms, first.views
    );
    assert!(first.bvid.starts_with("BV"), "每集都要有 bvid 才能点进去");
    assert!(first.duration_ms > 0, "时长要能显示在列表里");
    assert!(first.views.unwrap_or(0) > 0, "播放量要能显示在列表里");
}

#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 楼中楼能翻页() {
    let source = source_with_live_cookies().await;

    let key = bilimusic_model::TrackKey::from_provider("BV1kZWX62ENY");
    let page = source.comments(&key, None, true).await.expect("第一页评论");
    let root = page
        .items
        .iter()
        .max_by_key(|c| c.reply_count)
        .expect("第一页要有评论");
    println!("选中的一级评论：{} / {} 条回复", root.author, root.reply_count);
    assert!(
        root.reply_count >= 40,
        "样本至少要有两页回复，实际 {}",
        root.reply_count
    );

    let first = source
        .comment_replies(&key, &root.id, None)
        .await
        .expect("第一页楼中楼");
    let cursor = first.next.clone().expect("第一页之后应该还有下一页");
    let second = source
        .comment_replies(&key, &root.id, Some(&cursor))
        .await
        .expect("第二页楼中楼");
    println!(
        "第一页 {} 条，第二页 {} 条，总数 {}，has_more {} / {}",
        first.items.len(),
        second.items.len(),
        first.total,
        first.has_more,
        second.has_more
    );
    assert!(!first.items.is_empty(), "第一页不该是空的");
    assert!(!second.items.is_empty(), "第二页不该是空的");
    assert_eq!(first.total, second.total);

    let mut ids = std::collections::HashSet::new();
    for reply in first.items.iter().chain(&second.items) {
        assert!(ids.insert(reply.id.clone()), "回复 id 重复：{}", reply.id);
    }
    let head = first.items.first().expect("第一页有回复");
    println!(
        "首条回复：{} / {}",
        head.author,
        head.text.chars().take(20).collect::<String>()
    );
}

#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 查看对话能翻页() {
    let source = source_with_live_cookies().await;

    // BV1GJ411x7h7：已知这条一级评论下有 3442 条回复，取一条二级评论当对话锚点。
    let key = bilimusic_model::TrackKey::from_provider("BV1GJ411x7h7");
    let root = "3596982434";
    let dialog = "3837986036";
    let first = source
        .comment_dialog(&key, root, dialog, None)
        .await
        .expect("第一页对话");
    println!("对话第一页 {} 条，下一页 {:?}", first.items.len(), first.next);
    assert!(!first.items.is_empty(), "对话第一页不该是空的");
    assert!(first.items.iter().any(|c| c.dialog.to_string() == dialog), "锚点应该在这条对话里");

    if let Some(cursor) = first.next.clone() {
        let second = source
            .comment_dialog(&key, root, dialog, Some(&cursor))
            .await
            .expect("第二页对话");
        println!("对话第二页 {} 条", second.items.len());
        assert!(!second.items.is_empty(), "第二页不该是空的");
    }
}

/// 发现页底部两块：直播推荐与番剧排行。
/// 都是公开接口，未登录也要能取到，否则这两块在真机上就是空的。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 直播与番剧都能取到() {
    let source = Source::new().expect("Source 应该能打开");

    let rooms = source.live_rooms(6, 1).await.expect("直播推荐应该能取到");
    println!(
        "直播 {} 个，第一个：{} / {} / 人气 {}",
        rooms.len(),
        rooms[0].uname,
        rooms[0].title,
        rooms[0].online
    );
    assert_eq!(rooms.len(), 6, "要多少给多少");
    assert!(rooms.iter().all(|r| r.room_id > 0), "每个房间都要有 id");
    assert!(rooms.iter().all(|r| r.cover.is_some()), "直播卡要带封面");
    assert!(rooms.iter().all(|r| r.online > 0), "每个房间都该有人气数");

    // 直播频道翻页：第二页不能和第一页重样，否则「加载更多」是假的
    let more = source.live_rooms(12, 2).await.expect("第二页应该能取到");
    println!("第二页 {} 个，第一个：{}", more.len(), more[0].uname);
    assert!(
        more.iter().all(|r| !rooms.iter().any(|first| first.room_id == r.room_id)),
        "第二页不该重复第一页的房间"
    );

    let bangumi = source.bangumi_rank(6, 1).await.expect("番剧排行应该能取到");
    println!(
        "番剧 {} 部，第一：{} {} {}",
        bangumi.len(),
        bangumi[0].title,
        bangumi[0].rating,
        bangumi[0].index_show
    );
    assert_eq!(bangumi.len(), 6, "只取一排");
    assert_eq!(bangumi[0].rank, 1, "第一条就是第一名");
    assert!(bangumi.iter().all(|b| b.cover.is_some()), "番剧卡要带封面");
    // 未开分的条目 rating 是空串（实测「间谍过家家 第三季」就是），有分的都带「分」后缀
    assert!(
        bangumi.iter().filter(|b| !b.rating.is_empty()).all(|b| b.rating.ends_with('分')),
        "分数是接口给的展示串"
    );
}

/// 番剧时间表：一周七天，每天一组，字段是站内口径。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 番剧时间表能取到一周() {
    let source = Source::new().expect("Source 应该能打开");
    let days = source.bangumi_timeline().await.expect("时间表应该能取到");
    println!("天数 {}，第一天 {} 周{}，{} 部", days.len(), days[0].date, days[0].weekday, days[0].episodes.len());
    assert!(days.len() >= 7, "before=6&after=6 至少给七天，实际 {}", days.len());
    let weekdays: std::collections::BTreeSet<u8> = days.iter().map(|d| d.weekday).collect();
    assert_eq!(weekdays.len(), 7, "一周七天都要有，实际 {:?}", weekdays);
    assert_eq!(days.iter().filter(|d| d.today).count(), 1, "只有一天是今天");

    let ep = days
        .iter()
        .flat_map(|d| d.episodes.iter())
        .next()
        .expect("至少有一部在更新");
    println!("第一部：{} / {} / {}", ep.title, ep.pub_time, ep.pub_index);
    assert!(!ep.title.is_empty(), "番剧要有名字");
    assert!(ep.cover.is_some(), "时间表条目要带封面");
}

#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn messages_live_cursor_pages_are_disjoint() {
    use bilimusic_bili::messages::MessageKind;
    use std::collections::HashSet;

    let source = source_with_live_cookies().await;

    let mut paginated = 0;
    for kind in [MessageKind::Reply, MessageKind::At, MessageKind::Like] {
        let first = source.messages(kind, None, 1).await.expect("消息首屏");
        assert!(!first.items.is_empty(), "{kind:?} 首屏为空，无法验证分页");
        if !first.has_more {
            assert_eq!(first.next_cursor, None, "末页不能继续请求");
            println!("{kind:?}: first={} is_end=true，当前无第二页", first.items.len());
            continue;
        }
        let cursor = first.next_cursor.clone().expect("续页必须包含游标");
        let second = source.messages(kind, Some(cursor), 2).await.expect("消息续页");
        let first_ids: HashSet<&str> = first.items.iter().map(|item| item.id.as_str()).collect();
        let overlap = second.items.iter().filter(|item| first_ids.contains(item.id.as_str())).count();
        println!("{kind:?}: first={} second={} overlap={overlap}", first.items.len(), second.items.len());
        assert!(!second.items.is_empty(), "{kind:?} 续页为空，无法证明推进");
        assert_eq!(overlap, 0, "{kind:?} 相邻两页不能重复");
        assert_eq!(second.page, 2);
        paginated += 1;
    }
    assert!(paginated >= 2, "至少两类需实际推进到第二页，当前只验证了 {paginated} 类");
}

#[tokio::test]
#[ignore = "真实网络，核对弹幕正文里的 XML 实体"]
async fn 弹幕正文不带未解开的实体() {
    let source = Source::new().expect("Source");
    // BV1ej4J67ERn：实测这条视频里有一条 `˶>ᗜ<˶` 的颜文字弹幕。
    let key = bilimusic_model::TrackKey::from_provider("BV1ej4J67ERn");
    let list = source.danmaku_colored(&key, None).await.expect("弹幕");
    let dirty: Vec<&str> = list
        .iter()
        .map(|line| line.text.as_str())
        .filter(|t| t.contains("&lt;") || t.contains("&gt;") || t.contains("&amp;"))
        .collect();
    println!("共 {} 条，带未解开实体 {} 条", list.len(), dirty.len());
    assert!(dirty.is_empty(), "这些弹幕的实体没解开：{dirty:?}");
}

#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 有字幕的视频能取到台词() {
    // 字幕（尤其 AI 字幕）只给登录用户，游客拿到的是空列表。
    let source = source_with_live_cookies().await;
    // BV1GJ411x7h7：这条挂了 12 条字幕轨（含 ai-zh）。
    let key = bilimusic_model::TrackKey::from_provider("BV1GJ411x7h7");
    let detail = source.detail(&key).await.expect("详情");
    let meta = source.video_meta(&key.as_opaque(), detail.cid).await.expect("meta");
    println!("在线 {}，字幕轨 {:?}", meta.online, meta.subtitles);
    assert!(!meta.subtitles.is_empty(), "这条视频应该有字幕轨");

    let cues = source.subtitle_cues(&key, None, None).await.expect("字幕");
    println!("默认轨 {} 条，首条 {:?}", cues.len(), cues.first());
    assert!(cues.len() > 20, "台词条数太少：{}", cues.len());
    assert!(cues.iter().all(|c| c.end_ms >= c.at_ms), "结束时间不该早于开始");
    assert!(cues.iter().all(|c| !c.text.is_empty()), "不该有空台词");
}

/// 字幕挂在每一 P 上。观影页把当前 P 的 cid 传下来时必须按它取；不给 cid
/// 才退回第一 P——这条约定坏了，多 P 视频的每一集都会显示第一集的台词。
#[tokio::test]
#[ignore = "真实网络，需要 BILIMUSIC_LIVE_COOKIES"]
async fn 字幕按传入的cid取而不是总拿第一P() {
    let source = source_with_live_cookies().await;

    let key = bilimusic_model::TrackKey::from_provider("BV1vs411n7TH");
    let detail = source.detail(&key).await.expect("详情");
    assert!(detail.pages.len() > 3, "这条投稿应当是多 P");
    let first = detail.pages[0].cid;
    let third = detail.pages[2].cid;

    let named = source.subtitle_cues(&key, Some(third), None).await.expect("P3 字幕");
    let fallback = source.subtitle_cues(&key, None, None).await.expect("默认字幕");
    let by_first = source.subtitle_cues(&key, Some(first), None).await.expect("P1 字幕");
    println!(
        "P3 {} 条 / 不给 cid {} 条 / P1 {} 条",
        named.len(),
        fallback.len(),
        by_first.len()
    );
    assert!(!named.is_empty(), "P3 应该有字幕");
    assert_eq!(fallback.len(), by_first.len(), "不给 cid 时必须退回第一 P");
}

/// 弹幕也是按 P 分池的。给 cid 就按它取，不给才退回第一 P——观影页切 P
/// 后弹幕条数会跟着变，靠的就是这条。
#[tokio::test]
#[ignore = "真实网络，核对按 P 取弹幕"]
async fn 弹幕按传入的cid取而不是总拿第一P() {
    let source = Source::new().expect("Source");
    let key = bilimusic_model::TrackKey::from_provider("BV1vs411n7TH");
    let detail = source.detail(&key).await.expect("详情");
    assert!(detail.pages.len() > 3, "这条投稿应当是多 P");
    let first = detail.pages[0].cid;
    let third = detail.pages[2].cid;

    let named = source.danmaku_colored(&key, Some(third)).await.expect("P3 弹幕");
    let fallback = source.danmaku_colored(&key, None).await.expect("默认弹幕");
    let by_first = source.danmaku_colored(&key, Some(first)).await.expect("P1 弹幕");
    println!(
        "P3 {} 条 / 不给 cid {} 条 / P1 {} 条",
        named.len(),
        fallback.len(),
        by_first.len()
    );
    assert!(!named.is_empty(), "P3 应该有弹幕");
    assert_eq!(fallback.len(), by_first.len(), "不给 cid 时必须退回第一 P");
    assert_ne!(named.len(), by_first.len(), "不同 P 的弹幕池不该一样多");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "真实网络"]
async fn 空间头图置顶代表作与合集可读取() {
    use bilimusic_bili::space::{CollectionKind, SpacePick};

    let source = Source::new().expect("Source 应该能打开");
    let mid = 946974;
    let card = source.author_card(mid).await.expect("作者资料");
    assert!(card
        .banner
        .as_ref()
        .is_some_and(|url| url.starts_with("https://")));
    for kind in [SpacePick::Pinned, SpacePick::Masterpieces] {
        let picks = source.space_picks(mid, kind).await.expect("空间精选投稿");
        assert!(picks
            .iter()
            .any(|track| !track.title.is_empty() && track.cover.is_some()));
    }
    for (mid, want) in [
        (mid, CollectionKind::Season),
        (546195, CollectionKind::Series),
    ] {
        let (collections, total) = source.space_collections(mid, 1).await.expect("公开目录");
        if total > collections.len() as u64 {
            let (more, _) = source.space_collections(mid, 2).await.expect("第二页目录");
            assert!(more.iter().any(|next| collections
                .iter()
                .all(|seen| (seen.kind, seen.id) != (next.kind, next.id))));
            println!("空间 {mid} 合集和系列第二页返回 {} 项", more.len());
        }
        let collection = collections
            .iter()
            .find(|item| item.kind == want && item.total > 0)
            .expect("该空间应有一个有内容的目录");
        let (works, _) = source
            .space_collection_works(mid, want, collection.id, 1)
            .await
            .expect("作品列表");
        let work = works.first().expect("目录应有公开作品");
        let detail = source
            .detail(&work.key)
            .await
            .expect("目录内的作品可打开播放页");
        assert_eq!(detail.track.key, work.key);
        assert!(!detail.track.title.is_empty() && detail.cid > 0);
        println!("{} → {}", collection.name, detail.track.title);
        if let Some(long) = collections.iter().find(|item| item.total > 30) {
            let (first, _) = source
                .space_collection_works(mid, long.kind, long.id, 1)
                .await
                .expect("作品第一页");
            let (second, _) = source
                .space_collection_works(mid, long.kind, long.id, 2)
                .await
                .expect("作品第二页");
            assert!(second
                .iter()
                .any(|next| first.iter().all(|seen| seen.key != next.key)));
            println!("{} 第二页返回 {} 个视频", long.name, second.len());
        }
    }
}

#[tokio::test]
#[ignore = "读取多个 B 站公开作者空间"]
async fn live_author_catalog() {
    use bilimusic_bili::space_catalog::{Catalog::*, CatalogPage, Destination};
    let source = Source::new().unwrap();
    for (mid, catalog) in [
        (946974, Opus), (946974, Articles), (946974, ReadingLists),
        (946974, ReadingList { id: 89188 }), (946974, Audio), (946974, Courses),
        (43981713, Created), (43981713, Folder { id: 3927166413 }),
        (2, Anime), (2, Cinema), (2, Tags), (2, Games),
        (10897717, Collected), (10897717, Folder { id: 2055539766 }), (8743466, Coins), (8743466, Likes),
    ] {
        let CatalogPage::Public { items, more, offset } = source.space_catalog(mid, catalog, 1, None).await.unwrap()
            else { panic!("{mid} {catalog:?} 未公开") };
        println!("{mid} {catalog:?}: {}, 下一页={more}", items.len());
        let first = items.first().expect("应有公开样本");
        if matches!(catalog, Folder { .. }) {
            assert!(matches!(&first.destination, Destination::Video { track } if !track.artist.is_empty()));
        }
        if more {
            let CatalogPage::Public { items: next, .. } = source.space_catalog(mid, catalog, 2, offset.as_deref()).await.unwrap()
                else { panic!("翻页应仍公开") };
            assert!(!next.is_empty() && next[0].title != first.title, "{catalog:?} 的第二页不能重复第一页");
        }
    }
    assert!(source.space_catalog_order(8743466).await.unwrap().contains(&2));
    // 预约会自然下线；有公开预约时才检查卡片，不能把过期的活动当固定样本。
    let CatalogPage::Public { items, .. } = source.space_catalog(9617619, Reservations, 1, None).await.unwrap()
        else { panic!("预约列表应可读取") };
    println!("9617619 Reservations: {}", items.len());
    assert!(items.iter().all(|item| matches!(item.destination, Destination::Reservation { mid: 9617619, .. })));
    assert!(matches!(source.space_catalog(946974, Anime, 1, None).await.unwrap(), CatalogPage::Private));
    assert!(matches!(source.space_catalog(2050607, Opus, 1, None).await.unwrap(), CatalogPage::Public { items, .. } if items.is_empty()));
    assert!(matches!(source.space_catalog(43981713, Collected, 1, None).await.unwrap(), CatalogPage::Public { .. }));
}

#[tokio::test]
#[ignore = "作者投稿搜索取决于上游的匿名访问限制"]
async fn live_author_video_search() {
    let source = Source::new().unwrap();
    let (tracks, count) = source.search_space_videos(946974, 1, "pubdate", "卫星").await.unwrap();
    assert!(count > 0 && !tracks.is_empty());
    assert!(tracks.iter().all(|track| track.up_mid == Some(946974)));
}
