//! 把 bili 的视频轨转成界面能用的清单与档位表。
//!
//! 这一层只做搬运与命名，不做决策。挑编码与拼 MPD 的规则在 bili::dash 里。

use bilimusic_bili::dash::{to_video_mpd, VideoStream};
use serde::{Deserialize, Serialize};

/// 一个画质档位，给下拉菜单用。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualityOption {
    /// B 站的画质 id，112 是 1080P+，80 是 1080P，64 是 720P。
    pub id: u32,
    pub label: String,
    pub width: u32,
    pub height: u32,
}

pub fn video_mpd(video: &[VideoStream], duration_ms: u64, handle_of: impl Fn(&str) -> String) -> String {
    to_video_mpd(video, duration_ms, handle_of)
}

/// 按画质 id 归并，同一个 id 可能有多种编码，只留档位最高的一条。
pub fn quality_list(video: &[VideoStream]) -> Vec<QualityOption> {
    let mut out: Vec<QualityOption> = Vec::new();
    for v in video {
        let label = match v.id {
            127 => "8K".to_string(),
            126 => "杜比视界".to_string(),
            125 => "HDR".to_string(),
            120 => "4K".to_string(),
            116 | 112 => "1080P+".to_string(),
            80 => "1080P".to_string(),
            74 => "720P60".to_string(),
            64 => "720P".to_string(),
            32 => "480P".to_string(),
            16 => "360P".to_string(),
            other => format!("档位 {other}"),
        };
        match out.iter_mut().find(|q| q.id == v.id) {
            Some(existing) => {
                if v.width > existing.width || v.height > existing.height {
                    existing.width = v.width;
                    existing.height = v.height;
                }
            }
            None => out.push(QualityOption {
                id: v.id,
                label,
                width: v.width,
                height: v.height,
            }),
        }
    }
    // 高的在前，菜单从最好往下排
    out.sort_by(|a, b| b.height.cmp(&a.height).then(b.id.cmp(&a.id)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<VideoStream> {
        let raw = include_str!("../../bili/tests/fixtures/dash.json");
        let value: serde_json::Value = serde_json::from_str(raw).expect("fixture");
        serde_json::from_value(value["video"].clone()).expect("视频轨")
    }

    #[test]
    fn 档位按高度从高到低且不重复() {
        let list = quality_list(&fixture());
        assert!(!list.is_empty());
        let mut ids: Vec<u32> = list.iter().map(|q| q.id).collect();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "同一个画质 id 只该出现一次");
        for w in list.windows(2) {
            assert!(w[0].height >= w[1].height, "菜单要从高到低");
        }
    }

    #[test]
    fn 最高档是_1080p_plus() {
        let list = quality_list(&fixture());
        assert_eq!(list[0].height, 1080);
        assert_eq!(list[0].label, "1080P+");
    }
}
