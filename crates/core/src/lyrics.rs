//! 歌词：LRC 解析、lrclib 抓取、B 站字幕。
//!
//! 三级回退，任何一级失败都往下走，最后给出空文档而不是报错。

use bilimusic_model::{Millis, SearchQuery, Track};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LyricLine {
    pub at_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LyricDoc {
    pub lines: Vec<LyricLine>,
    pub synced: bool,
    pub source: String,
}

impl LyricDoc {
    pub fn empty() -> LyricDoc {
        LyricDoc {
            lines: Vec::new(),
            synced: false,
            source: "none".into(),
        }
    }

    pub fn current_index(&self, position: Millis) -> Option<usize> {
        if self.lines.is_empty() {
            return None;
        }
        let pos = position.0;
        let mut idx = None;
        for (i, line) in self.lines.iter().enumerate() {
            if line.at_ms <= pos {
                idx = Some(i);
            } else {
                break;
            }
        }
        idx.or(Some(0))
    }
}

/// 解析标准 LRC。`[mm:ss.xx]` 一行可带多个时间戳。
pub fn parse_lrc(raw: &str) -> LyricDoc {
    let mut lines: Vec<LyricLine> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut rest = trimmed;
        let mut stamps: Vec<u64> = Vec::new();
        while let Some(stripped) = rest.strip_prefix('[') {
            let Some(end) = stripped.find(']') else { break };
            let tag = &stripped[..end];
            if let Some(ms) = parse_stamp(tag) {
                stamps.push(ms);
            }
            rest = &stripped[end + 1..];
        }
        if stamps.is_empty() {
            continue;
        }
        let text = rest.trim().to_string();
        for ms in stamps {
            lines.push(LyricLine { at_ms: ms, text: text.clone() });
        }
    }
    lines.sort_by_key(|l| l.at_ms);
    LyricDoc {
        synced: !lines.is_empty(),
        lines,
        source: "lrc".into(),
    }
}

fn parse_stamp(tag: &str) -> Option<u64> {
    let (m, rest) = tag.split_once(':')?;
    let minutes: u64 = m.trim().parse().ok()?;
    let (s, frac) = match rest.split_once(['.', ':']) {
        Some((s, f)) => (s, Some(f)),
        None => (rest, None),
    };
    let seconds: u64 = s.trim().parse().ok()?;
    let millis = frac
        .map(|f| {
            let digits: String = f.chars().filter(|c| c.is_ascii_digit()).take(3).collect();
            let padded = format!("{digits:0<3}");
            padded.parse::<u64>().unwrap_or(0)
        })
        .unwrap_or(0);
    Some(minutes * 60_000 + seconds * 1000 + millis)
}

#[derive(Deserialize)]
struct LrclibHit {
    #[serde(default)]
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(default)]
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
}

/// 从 lrclib 找歌词。这个接口免鉴权，实测返回逐字时间轴。
pub async fn from_lrclib(
    http: &reqwest::Client,
    track: &Track,
) -> Option<LyricDoc> {
    let duration = track.duration.map(|d| d.0 / 1000).unwrap_or(0);
    let url = format!(
        "https://lrclib.net/api/get?artist_name={}&track_name={}&duration={}",
        urlencode(&track.artist),
        urlencode(&track.title),
        duration
    );
    let resp = http
        .get(url)
        .header("User-Agent", "BiliMusic/0.1 (https://github.com/bilimusic)")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let hit: LrclibHit = resp.json().await.ok()?;
    if let Some(synced) = hit.synced_lyrics {
        let mut doc = parse_lrc(&synced);
        if !doc.lines.is_empty() {
            doc.source = "lrclib".into();
            return Some(doc);
        }
    }
    let plain = hit.plain_lyrics?;
    let lines: Vec<LyricLine> = plain
        .lines()
        .filter(|l| !l.trim().is_empty())
        .enumerate()
        .map(|(i, l)| LyricLine {
            at_ms: i as u64 * 1000,
            text: l.trim().to_string(),
        })
        .collect();
    if lines.is_empty() {
        return None;
    }
    Some(LyricDoc {
        synced: false,
        lines,
        source: "lrclib-plain".into(),
    })
}

/// 用「歌手 - 歌名」拼一个用于搜歌词的查询。
pub fn guess_query(track: &Track) -> Option<SearchQuery> {
    SearchQuery::parse(&format!("{} {}", track.artist, track.title), 1).ok()
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 解析带毫秒的_lrc() {
        let doc = parse_lrc("[00:01.10]第一行\n[00:05.500]第二行\n");
        assert_eq!(doc.lines.len(), 2);
        assert_eq!(doc.lines[0].at_ms, 1100);
        assert_eq!(doc.lines[1].at_ms, 5500);
        assert!(doc.synced);
    }

    #[test]
    fn 一行多个时间戳会展开() {
        let doc = parse_lrc("[00:01.00][00:09.00]副歌");
        assert_eq!(doc.lines.len(), 2);
        assert_eq!(doc.lines[1].at_ms, 9000);
    }

    #[test]
    fn 没有时间戳的行被忽略() {
        let doc = parse_lrc("这是一句没有时间轴的话\n[00:02.00]有时间的");
        assert_eq!(doc.lines.len(), 1);
    }

    #[test]
    fn 当前行随时间推进() {
        let doc = parse_lrc("[00:01.00]a\n[00:03.00]b\n[00:06.00]c");
        assert_eq!(doc.current_index(Millis(1500)), Some(0));
        assert_eq!(doc.current_index(Millis(3500)), Some(1));
        assert_eq!(doc.current_index(Millis(99_000)), Some(2));
    }

    #[test]
    fn 空文档不崩溃() {
        let doc = LyricDoc::empty();
        assert_eq!(doc.current_index(Millis(1000)), None);
    }
}
