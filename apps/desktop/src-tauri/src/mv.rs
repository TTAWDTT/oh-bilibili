//! 本地 MV 代理。
//!
//! B 站视频 CDN 对非 bilibili 的 Referer 返回 403，而页面里的 `<video>` 无法自定义
//! Referer。所以视频字节必须由本机代理转发：它补上 Referer 与 Cookie，把 Range 原样
//! 传下去，再把 206 响应流回 webview。
//!
//! 只转发引擎铸过票的地址。前端拿到的是不透明句柄，既造不出远端地址，
//! 也没法把这个端口当任意代理用。

use bilimusic_core::engine::Engine;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// 从请求行里取出 `/m/<handle>` 的句柄。
fn handle_of(request_line: &str) -> Option<&str> {
    let path = request_line.split_whitespace().nth(1)?;
    path.strip_prefix("/m/").filter(|h| !h.is_empty())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn query(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    q.split('&')
        .find_map(|pair| pair.strip_prefix(key).and_then(|r| r.strip_prefix('=')))
        .map(percent_decode)
}

fn handle(mut stream: TcpStream, cookie: &str, engine: &Engine) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;

    let mut range: Option<String> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("range:") {
            range = Some(v.trim().to_string());
        }
    }

    // 只认 /m/<handle>。地址从票据表兑换，前端拿不到也造不出远端地址。
    let Some(ticket) = handle_of(&request_line) else {
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n");
        return Ok(());
    };
    let Some(target) = engine.redeem_stream(ticket) else {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n");
        return Ok(());
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(std::io::Error::other)?;
    let mut req = client
        .get(&target)
        .header("User-Agent", UA)
        .header("Referer", "https://www.bilibili.com/")
        .header("Origin", "https://www.bilibili.com");
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    if let Some(r) = range {
        req = req.header("Range", r);
    }
    let resp = req.send().map_err(std::io::Error::other)?;

    let status = resp.status();
    let mut head = format!("HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or("OK"));
    for name in ["content-type", "content-length", "content-range", "accept-ranges"] {
        if let Some(v) = resp.headers().get(name).and_then(|v| v.to_str().ok()) {
            head.push_str(&format!("{name}: {v}\r\n"));
        }
    }
    // webview 与代理不同源，放行跨域读取。
    head.push_str("access-control-allow-origin: *\r\nconnection: close\r\n\r\n");
    stream.write_all(head.as_bytes())?;

    let mut body = resp;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = body.read(&mut buf).map_err(std::io::Error::other)?;
        if n == 0 {
            break;
        }
        if stream.write_all(&buf[..n]).is_err() {
            break;
        }
    }
    Ok(())
}

/// 在 127.0.0.1 的随机端口上起代理，返回端口号。
pub fn spawn(cookie: String, engine: Arc<Engine>) -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    std::thread::Builder::new()
        .name("bilimusic-mv-proxy".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let cookie = cookie.clone();
                let engine = engine.clone();
                std::thread::spawn(move || {
                    let _ = handle(stream, &cookie, &engine);
                });
            }
        })?;
    Ok(port)
}
