//! 把一条带签名的音轨 URL 变成 `Read + Seek`。
//!
//! 这是「音频层不认识 B 站」那条边界的实现处：Referer 和 cookie 都在这里加上，
//! seek 靠重新发 Range 请求完成。

use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;
use std::time::Duration;

pub struct RemoteMedia {
    client: reqwest::blocking::Client,
    url: String,
    headers: Vec<(String, String)>,
    pos: u64,
    total: Option<u64>,
    response: Mutex<Option<reqwest::blocking::Response>>,
}

impl RemoteMedia {
    pub fn open(url: impl Into<String>, headers: Vec<(String, String)>) -> Result<RemoteMedia, String> {
        let url: String = url.into();
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        // 先量一次总长度，symphonia 的 MP4 读取器要靠它做 seek 边界判断。
        let mut probe = client.get(url.clone());
        for (k, v) in &headers {
            probe = probe.header(k.as_str(), v.as_str());
        }
        let head = probe
            .header("Range", "bytes=0-0")
            .send()
            .map_err(|e| e.to_string())?;
        let total = head
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit('/').next())
            .and_then(|s| s.parse::<u64>().ok());

        Ok(RemoteMedia {
            client,
            url,
            headers,
            pos: 0,
            total,
            response: Mutex::new(None),
        })
    }

    /// 丢掉当前连接，下次 read 会按 self.pos 重发 Range。
    fn drop_response(&self) {
        if let Ok(mut guard) = self.response.lock() {
            *guard = None;
        }
    }

    fn ensure_response(&self) -> std::io::Result<()> {
        let mut guard = self
            .response
            .lock()
            .map_err(|_| std::io::Error::other("音频流锁被毒化"))?;
        if guard.is_some() {
            return Ok(());
        }
        let mut req = self.client.get(self.url.clone());
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = req
            .header("Range", format!("bytes={}-", self.pos))
            .send()
            .map_err(std::io::Error::other)?;
        let status = resp.status();
        if !(status.is_success() || status.as_u16() == 206) {
            return Err(std::io::Error::other(format!("音频源返回 {status}")));
        }
        *guard = Some(resp);
        Ok(())
    }
}

impl Read for RemoteMedia {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        // B 站 CDN 的长连接会中途断掉。早先这里直接往上抛错，而解码线程遇到
        // 任何 IO 错误就 set_playing(false)——表现就是「播到随机位置突然停住」，
        // 进度冻结、按钮回到播放态。
        //
        // 现在在这里自己接住：只要还没读到末尾，就按当前偏移重发一次 Range 续上。
        for attempt in 0..3 {
            if let Err(e) = self.ensure_response() {
                if attempt == 2 {
                    return Err(e);
                }
                self.drop_response();
                std::thread::sleep(Duration::from_millis(120 * (attempt as u64 + 1)));
                continue;
            }
            let mut guard = match self.response.lock() {
                Ok(g) => g,
                Err(_) => return Err(std::io::Error::other("音频流锁被毒化")),
            };
            let Some(resp) = guard.as_mut() else {
                return Ok(0);
            };
            match resp.read(buf) {
                Ok(0) => {
                    // 0 是 EOF。只有真的到末尾才算播完；否则当作连接断了重连。
                    let at_end = self.total.is_some_and(|t| self.pos >= t);
                    drop(guard);
                    if at_end {
                        return Ok(0);
                    }
                    self.drop_response();
                    if attempt == 2 {
                        // 到这里还没读到文件末尾，不能把 0 交给解码器：
                        // Symphonia 会把它当成自然 EOF，引擎就弹出结束卡并切下一集。
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::ConnectionAborted,
                            "音频流在到达末尾前断开",
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(120 * (attempt as u64 + 1)));
                }
                Ok(n) => {
                    self.pos += n as u64;
                    return Ok(n);
                }
                Err(e) => {
                    drop(guard);
                    if attempt == 2 {
                        return Err(e);
                    }
                    // 丢掉断掉的连接，下一轮按 self.pos 重新 Range
                    self.drop_response();
                    std::thread::sleep(Duration::from_millis(120 * (attempt as u64 + 1)));
                }
            }
        }
        Ok(0)
    }
}

impl Seek for RemoteMedia {
    fn seek(&mut self, target: SeekFrom) -> std::io::Result<u64> {
        let next = match target {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(delta) => (self.pos as i64 + delta).max(0) as u64,
            SeekFrom::End(delta) => {
                let total = self
                    .total
                    .ok_or_else(|| std::io::Error::other("不知道音频总长"))?;
                (total as i64 + delta).max(0) as u64
            }
        };
        if next != self.pos {
            self.pos = next;
            // 换位置就丢掉旧连接，下次 read 会重新发 Range。
            if let Ok(mut guard) = self.response.lock() {
                *guard = None;
            }
        }
        Ok(self.pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seek_换位后位置正确() {
        let mut m = RemoteMedia {
            client: reqwest::blocking::Client::new(),
            url: "http://127.0.0.1:1/none".into(),
            headers: Vec::new(),
            pos: 0,
            total: Some(1000),
            response: Mutex::new(None),
        };
        assert_eq!(m.seek(SeekFrom::Start(100)).unwrap(), 100);
        assert_eq!(m.seek(SeekFrom::Current(50)).unwrap(), 150);
        assert_eq!(m.seek(SeekFrom::End(-150)).unwrap(), 850);
    }
}

#[cfg(test)]
mod reconnect_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// 前两次连接都在发了一小段后强行断开，第三次才把剩余字节发完。
    ///
    /// 这是 B 站 CDN 的真实行为：长连接会中途断。早先 read() 直接把错往上抛，
    /// 解码线程遇到 IO 错误就停播——表现就是「播到随机位置突然停住」。
    #[test]
    fn 断线后能按偏移续上() {
        let hits = Arc::new(AtomicUsize::new(0));
        let listener = TcpListener::bind("127.0.0.1:0").expect("端口");
        let port = listener.local_addr().expect("地址").port();
        let counter = hits.clone();

        std::thread::spawn(move || {
            const BODY: usize = 4096;
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let n = counter.fetch_add(1, Ordering::SeqCst);
                // 读掉请求头
                let mut head = [0u8; 2048];
                let _ = s.read(&mut head);
                // 解析 Range 起点
                let text = String::from_utf8_lossy(&head).to_string();
                let start = text
                    .split("bytes=")
                    .nth(1)
                    .and_then(|r| r.split('-').next())
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                let _ = s.write_all(
                    format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\n\r\n",
                        start, BODY - 1, BODY, BODY - start
                    )
                    .as_bytes(),
                );
                if n < 2 {
                    // 前两次只发 16 字节就断
                    let _ = s.write_all(&vec![b'A'; 16]);
                    continue;
                }
                let _ = s.write_all(&vec![b'B'; BODY - start]);
            }
        });

        std::thread::sleep(Duration::from_millis(120));
        let mut media =
            RemoteMedia::open(format!("http://127.0.0.1:{port}/x"), Vec::new()).expect("打开");

        let mut got = Vec::new();
        let mut buf = [0u8; 512];
        // 读到总长为止；断线应该被自动续上而不是报错
        for _ in 0..20 {
            match media.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => got.extend_from_slice(&buf[..n]),
                Err(e) => panic!("不该把断线抛给上层: {e}"),
            }
            if got.len() >= 4096 {
                break;
            }
        }
        println!("读到 {} 字节，建立了 {} 次连接", got.len(), hits.load(Ordering::SeqCst));
        assert!(got.len() >= 4096, "应该读完整段，实际 {}", got.len());
        assert!(hits.load(Ordering::SeqCst) >= 3, "应该重连过");
    }

    /// 一直断流且没读到文件末尾时，必须把错误交给解码器，
    /// 不能返回 0 让它误判成自然播完。
    #[test]
    fn 中途断流不能被当成自然播完() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("端口");
        let port = listener.local_addr().expect("地址").port();

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let mut head = [0u8; 2048];
                let _ = s.read(&mut head);
                let _ = s.write_all(
                    b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-0/4096\r\nContent-Length: 0\r\n\r\n",
                );
            }
        });

        std::thread::sleep(Duration::from_millis(120));
        let mut media =
            RemoteMedia::open(format!("http://127.0.0.1:{port}/x"), Vec::new()).expect("打开");
        let mut buf = [0u8; 128];
        let err = media.read(&mut buf).expect_err("断流不能被当成 EOF");
        assert_eq!(err.kind(), std::io::ErrorKind::ConnectionAborted);
    }
}
