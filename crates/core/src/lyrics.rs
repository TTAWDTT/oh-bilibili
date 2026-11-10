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
        // 前奏期间返回 None：B 站播放器此时也不显示歌词。
        // 原来这里 or(Some(0))，导致 29 秒前奏里一直挂着第一句。
        idx
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
            // 书名号里是歌名，要保留内容，只把符号本身换成空格。
            '《' | '》' => out.push(' '),
            '【' | '[' | '（' | '(' => depth += 1,
            '】' | ']' | '）' | ')' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    let mut cleaned = out.trim().to_string();
    for noise in [
        "MV", "mv", "官方版", "高清", "修复版", "完整版", "无损", "动态歌词", "歌词版", "翻唱",
        "2160P", "1080P", "720P", "4K", "8K", "Hi-Res", "HiRes", "杜比音效",
        // 帧率标记：标题里大量出现，不清掉会让同一首歌的缓存彼此对不上
        "120FPS", "60FPS", "30FPS", "fps", "FPS",
    ] {
        cleaned = cleaned.replace(noise, " ");
    }
    cleaned = cleaned.replace(['-', '｜', '|', '/', '·', '・', '—', '~'], " ");
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 搜索歌词时依次尝试的候选查询。
///
/// B 站投稿标题结构千奇百怪，单次查询命中率不够，用一组由粗到细的候选去试。
pub fn lyric_queries(raw: &str) -> Vec<String> {
    let whole = clean_title(raw);
    let mut out = Vec::new();
    if whole.is_empty() {
        return out;
    }
    out.push(whole.clone());

    let words: Vec<&str> = whole.split_whitespace().collect();
    if words.len() > 1 {
        // 歌名和歌手通常在前面，取前两个词命中率最高。
        out.push(words[..2.min(words.len())].join(" "));
        // 有些标题是「歌手 - 歌名」，尾部两个词也要试。
        if words.len() > 2 {
            out.push(words[words.len().saturating_sub(2)..].join(" "));
        }
        // 最后退到单个词：只要有一个能命中就行。
        for w in words.iter().filter(|w| w.chars().count() >= 2).take(3) {
            out.push((*w).to_string());
        }
    }
    // 去重且保序，避免重复打同一个查询。
    let mut seen = std::collections::HashSet::new();
    out.retain(|q| seen.insert(q.clone()));
    out
}

/// 从 lrclib 找歌词。这个接口免鉴权，实测返回逐字时间轴。
/// 本地 lrc：和下载目录同名放一份 `.lrc` 就能用。
pub fn from_local(track: &Track) -> Option<LyricDoc> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from)?;
    let dir = home.join("Music").join("BiliMusic");
    let base = clean_title(&track.title);
    if base.is_empty() {
        return None;
    }
    let path = dir.join(format!("{base}.lrc"));
    let raw = std::fs::read_to_string(path).ok()?;
    let doc = parse_lrc(&raw);
    if doc.lines.is_empty() {
        return None;
    }
    Some(doc)
}

pub async fn from_lrclib(http: &reqwest::Client, track: &Track) -> Option<LyricDoc> {
    // 候选词全部并发打出去，但**不**简单地「谁先回来用谁」：
    // 越靠后的候选越宽泛（会退到歌名单独一个词），先回来的可能是别的歌的歌词。
    //
    // 折中：等第一个结果之后再多给 250ms，让优先级更高的候选有机会追上；
    // 超过这个窗口就用当前最优的那条。实测健康网络下整体仍在 500~800ms。
    let keywords = lyric_queries(&track.title);
    if keywords.is_empty() {
        return None;
    }
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(usize, LyricDoc)>(keywords.len().max(1));
    let total = keywords.len();
    for (priority, keyword) in keywords.into_iter().enumerate() {
        let client = http.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            if let Some(hit) = query_lrclib(&client, &keyword).await {
                if let Some(doc) = hit_to_doc(hit) {
                    let _ = tx.send((priority, doc)).await;
                }
            }
        });
    }
    drop(tx);

    /// 拿到第一个结果后再等这么久，给高优先级候选一个追上的机会。
    const SETTLE: std::time::Duration = std::time::Duration::from_millis(250);

    let mut best: Option<(usize, LyricDoc)> = None;
    let mut deadline: Option<tokio::time::Instant> = None;
    loop {
        let wait_until = deadline.unwrap_or_else(|| tokio::time::Instant::now() + std::time::Duration::from_secs(5));
        let remaining = wait_until.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some((priority, doc))) => {
                if best.as_ref().map(|(p, _)| priority < *p).unwrap_or(true) {
                    best = Some((priority, doc));
                }
                // 第一优先级到手就没必要再等
                if priority == 0 {
                    break;
                }
                if deadline.is_none() {
                    deadline = Some(tokio::time::Instant::now() + SETTLE);
                }
            }
            // channel 关了：所有任务都结束
            Ok(None) => break,
            // 等待窗口用尽
            Err(_) => break,
        }
    }
    best.map(|(_, doc)| doc)
}

/// 一条查询 + 2 秒超时。健康的 lrclib 200~600ms 就回；
/// 被限流时要早放手，别把整首歌的等待拖长。
async fn query_lrclib(http: &reqwest::Client, keyword: &str) -> Option<LrclibHit> {
    let client = http.clone();
    let url = format!("https://lrclib.net/api/search?q={}", urlencode(keyword));
    let fut = async move {
        let resp = client
            .get(url)
            .header("User-Agent", "BiliMusic/0.1 (https://github.com/bilimusic)")
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        let list: Vec<LrclibHit> = resp.json().await.ok()?;
        list.into_iter().find(|h| h.synced_lyrics.is_some())
    };
    tokio::time::timeout(std::time::Duration::from_millis(2000), fut)
        .await
        .ok()
        .flatten()
}

/// 命中结果转成歌词文档。
fn hit_to_doc(hit: LrclibHit) -> Option<LyricDoc> {
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
    fn 前奏期间不该显示第一句() {
        // 《晴天》实测首行在 29300ms，前奏 29 秒里不该已经显示「故事的小黃花」
        let doc = parse_lrc("[00:29.30]故事的小黃花\n[00:33.00]从出生那年就飘着");
        assert_eq!(doc.current_index(Millis(0)), None, "前奏期间不该有当前行");
        assert_eq!(doc.current_index(Millis(10_000)), None, "前奏期间不该有当前行");
        assert_eq!(doc.current_index(Millis(29_300)), Some(0), "到点才显示");
    }

    #[test]
    fn 空文档不崩溃() {
        let doc = LyricDoc::empty();
        assert_eq!(doc.current_index(Millis(1000)), None);
    }
}

#[cfg(test)]
mod clean_tests {
    use super::{clean_title, lyric_queries};

    #[test]
    fn 中文书名号也要去掉() {
        // 实测拿不到歌词的那几条标题，都带《》而且没被清理
        assert_eq!(clean_title("【杜比音效】周杰伦《晴天》4K"), "周杰伦 晴天");
        assert_eq!(clean_title("【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《晴天》-周杰伦"), "晴天 周杰伦");
    }

    #[test]
    fn 候选查询覆盖整串与尾部() {
        let q = lyric_queries("【4K】周杰伦 晴天 完整版");
        assert!(q.contains(&"周杰伦 晴天".to_string()), "整串候选: {q:?}");
    }
}


#[cfg(test)]
mod real_lrc_tests {
    use super::{parse_lrc, Millis};

    /// 用 lrclib 真实返回的《晴天》逐字时间轴（44 行）核对「位置 → 该显示哪一句」。
    const QING_TIAN: &str = "[00:29.30] 故事的小黃花\n[00:32.77] 從出生那年就飄著\n[00:36.18] 童年的盪鞦韆\n[00:39.61] 隨記憶一直晃到現在\n[00:42.87] Re So So Si Do Si La\n[00:45.80] So La Si Si Si Si La Si La So\n[00:49.65] 吹著前奏望著天空\n[00:53.04] 我想起花瓣試著掉落\n[00:56.55] 為妳翹課的那一天 花落的那一天\n[01:00.57] 教室的那一間 我怎麼看不見\n[01:04.07] 消失的下雨天 我好想再淋一遍\n[01:09.84] 沒想到失去的勇氣我還留著\n[01:15.88] 好想再問一遍 妳會等待還是離開\n[01:24.87] 颳風這天 我試過握著妳手\n[01:30.48] 但偏偏 雨漸漸 大到我看妳不見\n[01:38.83] 還要多久 我才能在妳身邊\n[01:45.43] 等到放晴的那天 也許我會比較好一點\n[01:52.98] 從前從前 有個人愛妳很久\n[01:58.46] 但偏偏 風漸漸 把距離吹得好遠\n[02:06.72] 好不容易 又能再多愛一天\n[02:13.37] 但故事的最後妳好像還是說了拜拜\n[02:22.87] \n[02:34.62] 為妳翹課的那一天 花落的那一天\n[02:38.66] 教室的那一間 我怎麼看不見\n[02:42.11] 消失的下雨天 我好想再淋一遍\n[02:48.07] 沒想到失去的勇氣我還留著\n[02:54.03] 好想再問一遍 妳會等待還是離開\n[03:02.86] 颳風這天 我試過握著妳手\n[03:08.76] 但偏偏 雨漸漸 大到我看妳不見\n[03:16.71] 還要多久 我才能在妳身邊\n[03:23.49] 等到放晴的那天 也許我會比較好一點\n[03:30.93] 從前從前 有個人愛妳很久\n[03:36.92] 但偏偏 風漸漸 把距離吹得好遠\n[03:44.97] 好不容易 又能再多愛一天\n[03:51.42] 但故事的最後妳好像還是說了拜拜\n[03:58.23] 颳風這天 我試過握著妳手\n[04:01.74] 但偏偏 雨漸漸 大到我看妳不見\n[04:05.53] 還要多久 我才能在妳身邊\n[04:08.99] 等到放晴的那天 也許我會比較好一點\n[04:12.69] 從前從前 有個人愛妳很久\n[04:15.69] 但偏偏 雨漸漸 把距離吹得好遠\n[04:19.26] 好不容易 又能再多愛一天\n[04:22.76] 但故事的最後妳好像還是說了拜\n[04:25.78] ";

    #[test]
    fn 真实歌词的时间轴对得上() {
        let doc = parse_lrc(QING_TIAN);
        assert_eq!(doc.lines.len(), 44, "这首歌应该是 44 行");

        // 前奏 29.3 秒，此前不该显示任何一句
        assert_eq!(doc.current_index(Millis(0)), None);
        assert_eq!(doc.current_index(Millis(29_000)), None);

        // 到点显示第一句
        let first = doc.current_index(Millis(29_300)).expect("该有当前行");
        assert_eq!(doc.lines[first].text.trim(), "故事的小黃花");

        // 跳进主歌：60.57 秒那句
        let mid = doc.current_index(Millis(61_000)).expect("该有当前行");
        assert_eq!(doc.lines[mid].text.trim(), "教室的那一間 我怎麼看不見");

        // 再往后：69.84 秒那句
        let late = doc.current_index(Millis(70_000)).expect("该有当前行");
        assert_eq!(doc.lines[late].text.trim(), "沒想到失去的勇氣我還留著");

        // 每行时间戳必须严格递增，否则滚动会来回跳
        for w in doc.lines.windows(2) {
            assert!(w[0].at_ms < w[1].at_ms, "时间戳应递增：{} -> {}", w[0].at_ms, w[1].at_ms);
        }
    }
}

