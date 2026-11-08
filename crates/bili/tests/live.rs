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
