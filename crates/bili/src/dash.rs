//! 把 B 站的 DASH 清单变成 shaka 能吃的 MPD。
//!
//! 只产出视频轨。音频永远由 Rust 引擎出声，所以这份 MPD 里没有音频
//! AdaptationSet，视频元素上也就没有音轨，不会出现两路声音。

use serde::Deserialize;

/// 一条视频轨。字段来自 playurl 的 `dash.video[]`。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct VideoStream {
    pub id: u32,
    #[serde(rename = "baseUrl", alias = "base_url")]
    pub url: String,
    pub bandwidth: u64,
    pub codecs: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub frame_rate: Option<String>,
    #[serde(rename = "SegmentBase")]
    pub segment_base: SegmentBase,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SegmentBase {
    /// 初始化段的范围，形如 `0-1008`。
    #[serde(rename = "Initialization")]
    pub init: String,
    /// sidx 的范围，shaka 靠它定位分段。
    #[serde(rename = "indexRange")]
    pub index: String,
}

/// 只保留 AVC。HEVC 与 AV1 在部分 webview 上解不了，先不选。
fn is_safe_codec(codecs: &str) -> bool {
    codecs.starts_with("avc1")
}

/// 生成只含视频轨的 MPD。
///
/// `handle_of` 把远端地址换成播放器能访问的本机句柄。远端地址不进 MPD，
/// 也就不会出现在任何界面能读到的地方。
pub fn to_video_mpd(video: &[VideoStream], duration_ms: u64, handle_of: impl Fn(&str) -> String) -> String {
    let usable: Vec<&VideoStream> = video.iter().filter(|v| is_safe_codec(&v.codecs)).collect();
    let picks: Vec<&VideoStream> = if usable.is_empty() { video.iter().collect() } else { usable };
    let seconds = (duration_ms as f64 / 1000.0).max(0.1);
    let max_w = picks.iter().map(|v| v.width).max().unwrap_or(0);
    let max_h = picks.iter().map(|v| v.height).max().unwrap_or(0);
    let frame = picks
        .first()
        .and_then(|v| v.frame_rate.clone())
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| "25".into());

    let mut out = String::with_capacity(512 + picks.len() * 320);
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!(
        "<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\" mediaPresentationDuration=\"PT{seconds:.3}S\" minBufferTime=\"PT1.5S\" profiles=\"urn:mpeg:dash:profile:isoff-on-demand:2011\">\n"
    ));
    out.push_str(&format!("<Period duration=\"PT{seconds:.3}S\">\n"));
    out.push_str(&format!(
        "<AdaptationSet contentType=\"video\" mimeType=\"video/mp4\" segmentAlignment=\"true\" startWithSAP=\"1\" frameRate=\"{frame}\" maxWidth=\"{max_w}\" maxHeight=\"{max_h}\">\n"
    ));
    for v in picks {
        out.push_str(&format!(
            "<Representation id=\"v{id}\" bandwidth=\"{bw}\" codecs=\"{codecs}\" width=\"{w}\" height=\"{h}\">\
<BaseURL>{base}</BaseURL>\
<SegmentBase indexRange=\"{index}\"><Initialization range=\"{init}\"/></SegmentBase>\
</Representation>\n",
            id = v.id,
            bw = v.bandwidth,
            codecs = v.codecs,
            w = v.width,
            h = v.height,
            base = handle_of(&v.url),
            index = v.segment_base.index,
            init = v.segment_base.init,
        ));
    }
    out.push_str("</AdaptationSet>\n</Period>\n</MPD>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<VideoStream> {
        let raw = include_str!("../tests/fixtures/dash.json");
        let value: serde_json::Value = serde_json::from_str(raw).expect("fixture 可解析");
        serde_json::from_value(value["video"].clone()).expect("视频轨可解析")
    }

    #[test]
    fn 清单里只有视频没有音频() {
        let mpd = to_video_mpd(&fixture(), 213_000, |_| "http://127.0.0.1:1/m/x".into());
        assert!(mpd.contains("contentType=\"video\""));
        assert!(
            !mpd.contains("contentType=\"audio\""),
            "音频不许出现在这份 MPD 里，否则 webview 会二次发声"
        );
    }

    #[test]
    fn 每条轨道都带索引范围() {
        let mpd = to_video_mpd(&fixture(), 213_000, |_| "http://127.0.0.1:1/m/x".into());
        let reps = mpd.matches("<Representation").count();
        let indexes = mpd.matches("indexRange=").count();
        let inits = mpd.matches("Initialization range=").count();
        assert_eq!(reps, indexes, "每个 Representation 都要有 indexRange");
        assert_eq!(reps, inits, "每个 Representation 都要有初始化段");
        assert!(reps >= 3, "真实响应里应该有多个档位，实际 {reps}");
    }

    #[test]
    fn 远端地址不出现只出现句柄() {
        let mpd = to_video_mpd(&fixture(), 213_000, |_| "http://127.0.0.1:9/m/abc".into());
        assert!(!mpd.contains("fixture.invalid"), "远端地址不许进 MPD");
        assert!(mpd.contains("http://127.0.0.1:9/m/abc"));
    }

    #[test]
    fn 优先只放能解的编码() {
        let mpd = to_video_mpd(&fixture(), 213_000, |_| "h".into());
        if mpd.contains("codecs=\"") {
            // 只要存在 avc1 的轨道，就不该混进 hevc 或 av01
            assert!(!mpd.contains("hev1."), "混进了 HEVC");
            assert!(!mpd.contains("av01."), "混进了 AV1");
        }
    }
}
