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
        self.ensure_response()?;
        let mut guard = self
            .response
            .lock()
            .map_err(|_| std::io::Error::other("音频流锁被毒化"))?;
        let Some(resp) = guard.as_mut() else {
            return Ok(0);
        };
        let n = resp.read(buf)?;
        self.pos += n as u64;
        Ok(n)
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
