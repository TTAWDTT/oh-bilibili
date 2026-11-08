//! 搜索结果清洗与打分。
//!
//! 这是产品能不能用的地方：B 站搜「晴天」会返回翻唱、鬼畜、教程、演唱会片段。
//! 打分函数是纯函数，可以用真实抓下来的 fixture 做回归。

use bilimusic_model::{Millis, TrackKey};

/// 一条搜索候选，来自 wire，但在本模块内就清洗成领域形状。
#[derive(Debug, Clone)]
pub struct Candidate {
    pub bvid: String,
    pub title: String,
    pub artist: String,
    pub cover: Option<String>,
    pub duration: Option<Millis>,
    pub play: u64,
    pub typeid: u32,
    pub views: u64,
    pub danmaku: u64,
    pub up_avatar: Option<String>,
    pub score: f64,
}

/// 标题里出现这些词就降权。不是硬过滤，因为偶尔也会有正常投稿踩到。
const NEGATIVE: [&str; 10] = [
    "鬼畜", "教程", "教学", "搬运", "合集", "直播回放", "解说", "reaction", "翻唱教学", "求三连",
];

/// B 站的固定分区表。typeid 是接口给的，名字是查表得到的，不是编的。
pub fn partition_name(typeid: u32) -> Option<&'static str> {
    let name = match typeid {
        1 | 24 | 25 | 47 | 210 => "动画",
        3 | 28 | 29 | 30 | 31 | 59 | 130 | 193 | 171 => "音乐",
        4 | 17 | 65 | 136 | 171 => "游戏",
        5 | 71 => "娱乐",
        23 | 27 => "电影",
        11 | 13 => "电视剧",
        21 | 76 | 75 => "生活",
        119 => "鬼畜",
        129 => "舞蹈",
        138 | 239 => "搞笑",
        155 => "时尚",
        160 | 168 => "生活",
        181 => "影视",
        188 => "数码",
        201 | 124 => "科技",
        211 => "美食",
        217 => "动物",
        _ => return None,
    };
    Some(name)
}

/// B 站音乐区的一级分区 id。
const MUSIC_TYP: [u32; 2] = [3, 1008];

pub fn strip_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&quot;", "\"").replace("&amp;", "&").trim().to_string()
}

/// 关键词覆盖率：关键词里的每个词在标题里出现就算命中，返回 0 到 1。
fn keyword_coverage(keyword: &str, title: &str) -> f64 {
    let title_lower = title.to_lowercase();
    let tokens: Vec<&str> = keyword
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return 0.0;
    }
    let hit = tokens
        .iter()
        .filter(|t| title_lower.contains(&t.to_lowercase()))
        .count();
    hit as f64 / tokens.len() as f64
}

/// 时长合理性：2 到 6 分钟满分，60 秒以下或 12 分钟以上显著降权。
fn duration_fit(duration: Option<Millis>) -> f64 {
    let Some(d) = duration else { return 0.3 };
    let secs = d.as_secs();
    if secs < 60.0 {
        0.0
    } else if secs > 720.0 {
        0.15
    } else if (120.0..=360.0).contains(&secs) {
        1.0
    } else {
        0.6
    }
}

fn negative_penalty(title: &str) -> f64 {
    let lower = title.to_lowercase();
    NEGATIVE.iter().filter(|w| lower.contains(*w)).count() as f64
}

/// 播放量归一化。用对数，避免头部视频把分布压平。
fn play_score(play: u64) -> f64 {
    if play == 0 {
        return 0.0;
    }
    let l = (play as f64).ln();
    ((l - 6.0) / 10.0).clamp(0.0, 1.0)
}

pub fn score(keyword: &str, candidate: &Candidate) -> f64 {
    let base = keyword_coverage(keyword, &candidate.title) * 0.40
        + duration_fit(candidate.duration) * 0.20
        + if MUSIC_TYP.contains(&candidate.typeid) { 0.15 } else { 0.0 }
        + play_score(candidate.play) * 0.15
        + if candidate.artist.is_empty() { 0.0 } else { 0.10 };
    (base - negative_penalty(&candidate.title) * 0.12).max(0.0)
}

/// 排序并去重。同一个 UP 主同一首歌重复投稿只留分数最高的那条。
pub fn rank(keyword: &str, mut candidates: Vec<Candidate>) -> Vec<Candidate> {
    for c in candidates.iter_mut() {
        c.score = score(keyword, c);
    }
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| {
        let dedupe_key = format!("{}|{}", c.artist, normalize_title(&c.title));
        seen.insert(dedupe_key)
    });
    candidates
}

fn normalize_title(title: &str) -> String {
    title
        .chars()
        .filter(|c| c.is_alphanumeric() || *c > '\u{4e00}')
        .collect::<String>()
        .to_lowercase()
}

/// 把候选变成领域 Track。bvid 在这一步被封进不透明的 TrackKey。
pub fn to_track(c: &Candidate) -> bilimusic_model::Track {
    bilimusic_model::Track {
        key: TrackKey::from_provider(c.bvid.clone()),
        title: c.title.clone(),
        artist: c.artist.clone(),
        duration: c.duration,
        cover: c.cover.clone(),
        accent: None,
        views: Some(c.views).filter(|v| *v > 0),
        danmaku: Some(c.danmaku).filter(|v| *v > 0),
        up_avatar: c.up_avatar.clone(),
        tname: partition_name(c.typeid).map(|n| n.to_string()),
        typeid: Some(c.typeid),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(title: &str, dur: u64, typ: u32, play: u64) -> Candidate {
        Candidate {
            bvid: "BV1".into(),
            title: title.into(),
            artist: "某 UP".into(),
            cover: None,
            duration: Some(Millis(dur * 1000)),
            play,
            typeid: typ,
            views: 1000,
            danmaku: 10,
            up_avatar: None,
            score: 0.0,
        }
    }

    #[test]
    fn 标签被剥掉() {
        assert_eq!(strip_tags("周杰伦 - <em>晴天</em>"), "周杰伦 - 晴天");
    }

    #[test]
    fn 原曲排在鬼畜前面() {
        let good = cand("周杰伦 - 晴天", 269, 3, 5_000_000);
        let bad = cand("晴天鬼畜教程合集", 90, 3, 100);
        let ranked = rank("晴天", vec![bad, good]);
        assert_eq!(ranked[0].title, "周杰伦 - 晴天");
    }

    #[test]
    fn 短视频被压下去() {
        let short = cand("晴天 30 秒", 30, 3, 900_000);
        let full = cand("晴天 完整版", 269, 3, 500_000);
        let ranked = rank("晴天", vec![short, full]);
        assert_eq!(ranked[0].title, "晴天 完整版");
    }

    #[test]
    fn 同主同歌只留一条() {
        let a = cand("晴天 - 周杰伦", 269, 3, 9_000_000);
        let mut b = cand("晴天 周杰伦", 269, 3, 100);
        b.artist = "某 UP".into();
        let ranked = rank("晴天", vec![a, b]);
        assert_eq!(ranked.len(), 1);
    }

    #[test]
    fn 空关键词覆盖率是零() {
        assert_eq!(keyword_coverage("", "晴天"), 0.0);
    }
}
