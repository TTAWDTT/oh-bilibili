//! 谁能被本机代理转发的唯一决定处。
//!
//! 早先代理收 `?u=<完整地址>` 并按域名白名单放行。DASH 分段来自二十多个
//! 主机，其中一半是第三方 PCDN，域名清单必然漏，而且那个入口能代理
//! bilivideo 上的任意资源。改成票据之后，前端只能拿到不透明句柄。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 票据有效期。B 站的播放地址本身会过期，这里比它更短，
/// 让一张泄漏的票在几分钟内失效。
pub const TTL: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
struct Ticket {
    url: String,
    minted_at: Instant,
}

#[derive(Default)]
pub struct Tickets {
    next: Mutex<u64>,
    live: Mutex<HashMap<String, Ticket>>,
}

impl Tickets {
    pub fn new() -> Tickets {
        Tickets::default()
    }

    /// 铸造一张票。远端地址从 playurl 响应里来，别处不铸造。
    pub fn mint(&self, url: impl Into<String>) -> String {
        let mut next = self.next.lock().unwrap_or_else(|e| e.into_inner());
        *next += 1;
        let handle = format!("t{}", *next);
        drop(next);
        let mut live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        live.insert(
            handle.clone(),
            Ticket {
                url: url.into(),
                minted_at: Instant::now(),
            },
        );
        handle
    }

    /// 代理收到请求时兑换。未知或过期返回 None，调用方回 404。
    pub fn redeem(&self, handle: &str) -> Option<String> {
        self.redeem_at(handle, Instant::now())
    }

    fn redeem_at(&self, handle: &str, now: Instant) -> Option<String> {
        let mut live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        // 顺手清过期项，免得表无限长
        live.retain(|_, t| now.duration_since(t.minted_at) < TTL);
        live.get(handle).map(|t| t.url.clone())
    }

    pub fn len(&self) -> usize {
        self.live.lock().map(|l| l.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 铸出的票能换回原地址() {
        let t = Tickets::new();
        let h = t.mint("https://example.invalid/a.m4s");
        assert_eq!(t.redeem(&h).as_deref(), Some("https://example.invalid/a.m4s"));
    }

    #[test]
    fn 每张票都不一样() {
        let t = Tickets::new();
        let a = t.mint("https://example.invalid/a");
        let b = t.mint("https://example.invalid/b");
        assert_ne!(a, b);
        assert_eq!(t.redeem(&a).as_deref(), Some("https://example.invalid/a"));
        assert_eq!(t.redeem(&b).as_deref(), Some("https://example.invalid/b"));
    }

    #[test]
    fn 没铸过的票换不出东西() {
        let t = Tickets::new();
        assert!(t.redeem("t999").is_none());
        assert!(t.redeem("").is_none());
        assert!(t.redeem("https://evil.invalid/x").is_none(), "地址当票用必须失败");
    }

    #[test]
    fn 过期的票换不出来() {
        let t = Tickets::new();
        let h = t.mint("https://example.invalid/a");
        let later = Instant::now() + TTL + Duration::from_secs(1);
        assert!(t.redeem_at(&h, later).is_none());
        assert_eq!(t.len(), 0, "过期项应该被清掉");
    }
}
