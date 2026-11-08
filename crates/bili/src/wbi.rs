//! wbi 签名。
//!
//! B 站在 2023 年把网页端接口的签名换成了 wbi：从 nav 取两张密钥图，
//! 用固定重排表混出一把 key，再把参数按字典序拼起来做 md5。
//! 算法一旦变动，只需要改这个文件。

use md5::{Digest, Md5};

/// B 站硬编码的 64 位重排表。
const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22,
    25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

#[derive(Debug, Clone)]
pub struct WbiKeys {
    img_key: String,
    sub_key: String,
}

impl WbiKeys {
    /// 从 nav 返回的两张密钥图 URL 里取文件名，作为两个 key。
    pub fn from_image_urls(img_url: &str, sub_url: &str) -> Option<WbiKeys> {
        let img_key = basename(img_url)?;
        let sub_key = basename(sub_url)?;
        Some(WbiKeys { img_key, sub_key })
    }

    pub fn img_key(&self) -> &str {
        &self.img_key
    }
    pub fn sub_key(&self) -> &str {
        &self.sub_key
    }

    fn mixin_key(&self) -> String {
        let raw = format!("{}{}", self.img_key, self.sub_key);
        let bytes: Vec<char> = raw.chars().collect();
        MIXIN_KEY_ENC_TAB
            .iter()
            .filter_map(|&i| bytes.get(i).copied())
            .take(32)
            .collect()
    }

    /// 返回完整的查询串，含 `wts` 与 `w_rid`，调用方直接拼到 URL 后面。
    pub fn sign(&self, params: &[(&str, String)], wts: u64) -> String {
        let mut all: Vec<(&str, String)> = params.to_vec();
        all.push(("wts", wts.to_string()));
        all.sort_by(|a, b| a.0.cmp(b.0));

        let query = all
            .iter()
            .map(|(k, v)| format!("{}={}", encode_uri_component(k), encode_uri_component(v)))
            .collect::<Vec<_>>()
            .join("&");

        let mut hasher = Md5::new();
        hasher.update(query.as_bytes());
        hasher.update(self.mixin_key().as_bytes());
        let w_rid = format!("{:x}", hasher.finalize());
        format!("{query}&w_rid={w_rid}")
    }
}

/// 与 JavaScript 的 `encodeURIComponent` 等价，并去掉 B 站要求过滤的字符。
pub fn encode_uri_component(raw: &str) -> String {
    let filtered = raw.replace(['!', '\'', '(', ')', '*'], "");
    let mut out = String::with_capacity(filtered.len() * 3);
    for byte in filtered.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn basename(url: &str) -> Option<String> {
    url.rsplit('/')
        .next()?
        .split('.')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 密钥从文件名里取() {
        let k = WbiKeys::from_image_urls(
            "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
            "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        )
        .expect("应该能解析");
        assert_eq!(k.img_key(), "7cd084941338484aae1ad9425b84077c");
        assert_eq!(k.sub_key(), "4932caff0ff746eab6f01bf08b70ac45");
    }

    #[test]
    fn 混音键是纯重排不加字符() {
        let k = WbiKeys {
            img_key: "7cd084941338484aae1ad9425b84077c".into(),
            sub_key: "4932caff0ff746eab6f01bf08b70ac45".into(),
        };
        let mixin = k.mixin_key();
        assert_eq!(mixin.len(), 32);
        let allowed: std::collections::HashSet<char> =
            "7cd084941338484aae1ad9425b84077c4932caff0ff746eab6f01bf08b70ac45"
                .chars()
                .collect();
        assert!(mixin.chars().all(|c| allowed.contains(&c)));
    }

    #[test]
    fn 签名产物包含_wts_与_w_rid() {
        let k = WbiKeys {
            img_key: "7cd084941338484aae1ad9425b84077c".into(),
            sub_key: "4932caff0ff746eab6f01bf08b70ac45".into(),
        };
        let q = k.sign(
            &[("search_type", "video".into()), ("keyword", "晴天".into())],
            1700000000,
        );
        assert!(q.contains("w_rid="));
        assert!(q.contains("wts=1700000000"));
        assert!(q.contains("keyword=%E6%99%B4%E5%A4%A9"));
        assert!(q.starts_with("keyword="));
    }

    #[test]
    fn 编码过滤保留字符() {
        assert_eq!(encode_uri_component("a b&c"), "a%20b%26c");
        assert_eq!(encode_uri_component("a!b'c(d)e*f"), "abcdef");
    }
}
