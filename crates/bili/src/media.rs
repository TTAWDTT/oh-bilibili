//! 把一条带签名的音轨 URL 变成 `Read + Seek`。
//!
//! 这是「音频层不认识 B 站」那条边界的实现处：Referer 和 cookie 都在这里加上，
//! seek 靠重新发 Range 请求完成。

use std::io::{self, Read, Seek, SeekFrom};
use std::sync::Mutex;
use std::time::Duration;

/// 一次 Range 最多拉这么多。长连接一旦被 CDN 挂住，整条流会永久停住；
/// 分成小块后，单块超时就能丢掉连接、从当前偏移重连。
const CHUNK_SIZE: u64 = 256 * 1024;

pub struct RemoteMedia {
    client: reqwest::blocking::Client,
    url: String,
    headers: Vec<(String, String)>,
    pos: u64,
    total: Option<u64>,
    response: Mutex<Option<RangeResponse>>,
}

struct RangeResponse {
    body: reqwest::blocking::Response,
    end: Option<u64>,
}

fn content_range(response: &reqwest::blocking::Response) -> Option<(u64, u64, Option<u64>)> {
    let value = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?;
    let (range, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = end.parse::<u64>().ok()?.checked_add(1)?;
    let total = total.parse::<u64>().ok();
    (start < end && total.map_or(true, |total| end <= total)).then_some((start, end, total))
}

impl RemoteMedia {
    pub fn open(
        url: impl Into<String>,
        headers: Vec<(String, String)>,
    ) -> Result<RemoteMedia, String> {
        let url: String = url.into();
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(8))
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
        let total = content_range(&head).and_then(|(_, _, total)| total);

        Ok(RemoteMedia {
            client,
            url,
            headers,
            pos: 0,
            total,
            response: Mutex::new(None),
        })
    }

    fn open_response(&mut self) -> io::Result<RangeResponse> {
        let mut req = self.client.get(self.url.clone());
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let end = match self.total {
            Some(total) if self.pos < total => (self.pos + CHUNK_SIZE - 1).min(total - 1),
            _ => self.pos + CHUNK_SIZE - 1,
        };
        let body = req
            .header("Range", format!("bytes={}-{}", self.pos, end))
            .send()
            .map_err(io::Error::other)?;
        let response_end = match body.status() {
            reqwest::StatusCode::PARTIAL_CONTENT => {
                let (_, response_end, total) = content_range(&body)
                    .filter(|(start, response_end, _)| {
                        *start == self.pos && *response_end <= end + 1
                    })
                    .ok_or_else(|| {
                        io::Error::new(
                            io::ErrorKind::InvalidData,
                            "音频源返回了错误的 Content-Range",
                        )
                    })?;
                self.total = total.or(self.total);
                Some(response_end)
            }
            reqwest::StatusCode::OK if self.pos == 0 => {
                self.total = body.content_length().or(self.total);
                self.total
            }
            status => return Err(io::Error::other(format!("音频源返回 {status}"))),
        };
        Ok(RangeResponse {
            body,
            end: response_end,
        })
    }

    fn read_range(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.response.get_mut().unwrap().is_none() {
            let response = self.open_response()?;
            *self.response.get_mut().unwrap() = Some(response);
        }
        let slot = self.response.get_mut().unwrap();
        let response = slot.as_mut().unwrap();
        let count = response.body.read(buf)?;
        if count == 0 && response.end.is_some_and(|end| self.pos < end) {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "音频流在到达末尾前断开",
            ));
        }
        self.pos += count as u64;
        if response.end == Some(self.pos) {
            *slot = None;
        }
        Ok(count)
    }
}

impl Read for RemoteMedia {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if buf.is_empty() || self.total.is_some_and(|total| self.pos >= total) {
            return Ok(0);
        }
        // B 站 CDN 的长连接会中途断掉。早先这里直接往上抛错，而解码线程遇到
        // 任何 IO 错误就 set_playing(false)——表现就是「播到随机位置突然停住」，
        // 进度冻结、按钮回到播放态。
        //
        // 现在在这里自己接住：只要还没读到末尾，就按当前偏移重发一次 Range 续上。
        let mut attempts = 0;
        loop {
            match self.read_range(buf) {
                Ok(n) => return Ok(n),
                Err(e) => {
                    *self.response.get_mut().unwrap() = None;
                    attempts += 1;
                    if attempts == 3 {
                        return Err(e);
                    }
                    std::thread::sleep(Duration::from_millis(120 * attempts));
                }
            }
        }
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
            *self.response.get_mut().unwrap() = None;
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn 正常的_range_边界不退避() {
        use std::io::BufRead;
        use std::time::Instant;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let fixture = include_bytes!("../../audio/tests/fixtures/fragmented.m4s").repeat(15);
        let server_fixture = fixture.clone();
        let server = std::thread::spawn(move || {
            let mut starts = Vec::new();
            loop {
                let (mut stream, _) = listener.accept().unwrap();
                let range = std::io::BufReader::new(&stream)
                    .lines()
                    .map_while(Result::ok)
                    .take_while(|line| !line.is_empty())
                    .find_map(|line| line.strip_prefix("range: bytes=").map(str::to_owned))
                    .unwrap();
                let (start, end) = range.split_once('-').unwrap();
                let start: usize = start.parse().unwrap();
                let end = end.parse::<usize>().unwrap().min(server_fixture.len() - 1);
                let bytes = &server_fixture[start..=end];
                write!(
                    stream,
                    "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{end}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    server_fixture.len(),
                    bytes.len()
                )
                .unwrap();
                stream.write_all(bytes).unwrap();
                starts.push(start);
                if end == server_fixture.len() - 1 {
                    return starts;
                }
            }
        });

        let mut media = RemoteMedia::open(format!("http://{addr}/audio"), Vec::new()).unwrap();
        let start = Instant::now();
        let mut got = Vec::new();
        media.read_to_end(&mut got).unwrap();
        let elapsed = start.elapsed();
        let starts = server.join().unwrap();
        let expected = std::iter::once(0)
            .chain((0..fixture.len()).step_by(CHUNK_SIZE as usize))
            .collect::<Vec<_>>();
        println!("{} bytes, {} ranges, {elapsed:?}", got.len(), starts.len());
        assert_eq!(got, fixture);
        assert_eq!(starts, expected);
        assert!(elapsed < Duration::from_millis(360), "{elapsed:?}");
    }

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
        let bounded = Arc::new(AtomicBool::new(false));
        let bounded_server = bounded.clone();

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
                let end = text
                    .split("bytes=")
                    .nth(1)
                    .and_then(|r| r.split('-').nth(1))
                    .map(|v| v.chars().take_while(|c| c.is_ascii_digit()).collect::<String>())
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(0);
                if end > start {
                    bounded_server.store(true, Ordering::SeqCst);
                }
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
        assert!(bounded.load(Ordering::SeqCst), "Range 必须带有限终点");
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
