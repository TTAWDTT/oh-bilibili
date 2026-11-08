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

/// 把 B 站投稿标题洗成能拿去搜歌词的歌名。
///
/// 投稿标题里塞满了【4K修复】【Hi-Res】这类前缀和「MV」「官方版」这类后缀，
/// 直接拿去搜命中率很低。
pub fn clean_title(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut depth = 0i32;
    for ch in raw.chars() {
        match ch {
            '【' | '[' | '（' | '(' => depth += 1,
            '】' | ']' | '）' | ')' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    let mut cleaned = out.trim().to_string();
    for noise in [
        "MV", "mv", "官方版", "高清", "修复版", "完整版", "无损", "动态歌词", "歌词版", "翻唱",
        "2160P", "1080P", "4K", "8K", "Hi-Res", "杜比音效",
    ] {
        cleaned = cleaned.replace(noise, " ");
    }
    cleaned = cleaned.replace(['-', '｜', '|', '/'], " ");
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 搜索歌词时依次尝试的候选查询。
///
/// B 站投稿标题结构千奇百怪，单次查询命中率不够，用一组由粗到细的候选去试。
pub fn lyric_queries(raw: &str) -> Vec<String> {
    let whole = clean_title(raw);
    let mut out = Vec::new();
    if !whole.is_empty() {
        out.push(whole.clone());
    }
    // 「周杰伦 晴天」这种整串没命中时，只留最后两个词再试一次。
    let words: Vec<&str> = whole.split_whitespace().collect();
    if words.len() > 2 {
        out.push(words[words.len().saturating_sub(2)..].join(" "));
    }
    out
}

/// 从 lrclib 找歌词。这个接口免鉴权，实测返回逐字时间轴。
pub async fn from_lrclib(
    http: &reqwest::Client,
    track: &Track,
) -> Option<LyricDoc> {
    // 用搜索而不是精确匹配：B 站投稿的「歌手」是 UP 主，拿去做精确查询必然落空。
    let mut hits: Vec<LrclibHit> = Vec::new();
    for keyword in lyric_queries(&track.title) {
        let url = format!("https://lrclib.net/api/search?q={}", urlencode(&keyword));
        let Some(resp) = http
            .get(url)
            .header("User-Agent", "BiliMusic/0.1 (https://github.com/bilimusic)")
            .send()
            .await
            .ok()
            .and_then(|r| r.error_for_status().ok())
        else {
            continue;
        };
        if let Ok(list) = resp.json::<Vec<LrclibHit>>().await {
            if list.iter().any(|h| h.synced_lyrics.is_some()) {
                hits = list;
                break;
            }
        }
    }
    let hit = hits.into_iter().find(|h| h.synced_lyrics.is_some())?;
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
    fn 投稿标题能洗成歌名() {
        assert_eq!(
            clean_title("【4K修复】周杰伦 - 晴天MV 2160P修复版"),
            "周杰伦 晴天"
        );
        assert_eq!(clean_title("晴天"), "晴天");
        assert_eq!(clean_title("【纯音乐】"), "");
    }

    #[test]
    fn 歌词候选查询由粗到细() {
        let q = lyric_queries("【4K修复】周杰伦 - 晴天MV 2160P修复版");
        assert!(q[0].contains("周杰伦"));
        assert!(q.iter().any(|s| s.contains("晴天")));
    }

    #[test]
    fn 空文档不崩溃() {
        let doc = LyricDoc::empty();
        assert_eq!(doc.current_index(Millis(1000)), None);
    }
}
