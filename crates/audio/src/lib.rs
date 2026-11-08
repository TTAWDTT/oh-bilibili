//! 音频引擎。
//!
//! 这个 crate 只认识 `Read + Seek`，不认识 URL、Referer、cookie。
//! 解码与输出分两个线程：解码线程往前推，声卡回调消费，中间是一个有界环形缓冲。

use std::io::{Read, Seek, SeekFrom};

pub mod player;
pub use player::Player;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// 音频层认识的唯一输入。网络流、本地文件、内存缓冲在它面前同构。
///
/// 这是一个外壳，把 `Read + Seek` 转成 symphonia 要求的类型，
/// 这样 symphonia 的类型不会出现在本 crate 的公共 API 上。
pub struct Media(Box<dyn symphonia::core::io::MediaSource>);

impl Media {
    /// 交给解码器时用。这是本 crate 内部唯一的出口。
    pub(crate) fn into_inner(self) -> Box<dyn symphonia::core::io::MediaSource> {
        self.0
    }

    pub fn new<T>(mut inner: T) -> Media
    where
        T: Read + Seek + Send + Sync + 'static,
    {
        // symphonia 的 MP4 读取器要知道总长才能 seek，所以这里先量一次，
        // 量不到就退回不可 seek 的流式模式。
        let len = inner
            .seek(SeekFrom::End(0))
            .ok()
            .filter(|n| *n > 0)
            .and_then(|n| inner.seek(SeekFrom::Start(0)).ok().map(|_| n));
        Media(Box::new(MediaWrapper { inner, len }))
    }
}

struct MediaWrapper<T> {
    inner: T,
    len: Option<u64>,
}

impl<T: Read> Read for MediaWrapper<T> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl<T: Seek> Seek for MediaWrapper<T> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

impl<T: Read + Seek + Send + Sync> symphonia::core::io::MediaSource for MediaWrapper<T> {
    fn is_seekable(&self) -> bool {
        self.len.is_some()
    }
    fn byte_len(&self) -> Option<u64> {
        self.len
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("打不开媒体：{0}")]
    Open(String),
    #[error("没有可解码的音轨")]
    NoTrack,
    #[error("解码失败：{0}")]
    Decode(String),
    #[error("声卡错误：{0}")]
    Device(String),
}

#[derive(Debug, Clone)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: usize,
    /// 交错排列的浮点样本。
    pub samples: Vec<f32>,
}

impl DecodedAudio {
    pub fn frames(&self) -> usize {
        if self.channels == 0 {
            0
        } else {
            self.samples.len() / self.channels
        }
    }
    pub fn duration_ms(&self) -> u64 {
        if self.sample_rate == 0 {
            0
        } else {
            (self.frames() as u64 * 1000) / self.sample_rate as u64
        }
    }
}

/// 把整段媒体解码成内存里的 PCM。
///
/// 整段解码只用于验证与短音频；播放走 [`crate::Decoder`] 的流式路径。
pub fn decode_all(media: Media) -> Result<DecodedAudio, AudioError> {
    let mss = MediaSourceStream::new(media.0, Default::default());
    let mut hint = Hint::new();
    hint.with_extension("m4a");

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| AudioError::Open(e.to_string()))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or(AudioError::NoTrack)?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AudioError::Decode(e.to_string()))?;

    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let mut channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(2);
    let mut samples: Vec<f32> = Vec::new();
    let mut buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(symphonia::core::errors::Error::ResetRequired) => break,
            Err(e) => return Err(AudioError::Decode(e.to_string())),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                sample_rate = spec.rate;
                channels = spec.channels.count();
                if buf.is_none() {
                    buf = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
                }
                if let Some(sb) = buf.as_mut() {
                    sb.copy_interleaved_ref(decoded);
                    samples.extend_from_slice(sb.samples());
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(AudioError::Decode(e.to_string())),
        }
    }

    if samples.is_empty() {
        return Err(AudioError::Decode("解出来是空的".into()));
    }
    Ok(DecodedAudio {
        sample_rate,
        channels,
        samples,
    })
}

/// 播放进度。全应用只有声卡侧写它，UI 拿到的都是这里的投影。
#[derive(Debug, Default)]
pub struct Clock {
    frames: AtomicU64,
    sample_rate: AtomicU64,
    playing: AtomicBool,
}

impl Clock {
    pub fn position_ms(&self) -> u64 {
        let rate = self.sample_rate.load(Ordering::Relaxed);
        if rate == 0 {
            return 0;
        }
        self.frames.load(Ordering::Relaxed) * 1000 / rate
    }
    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }
    pub fn advance(&self, frames: u64) {
        self.frames.fetch_add(frames, Ordering::Relaxed);
    }
    pub fn reset(&self, sample_rate: u32) {
        self.frames.store(0, Ordering::Relaxed);
        self.sample_rate.store(sample_rate as u64, Ordering::Relaxed);
    }
    /// seek 之后重设位置。帧计数是唯一真值，所以这里直接换算成帧。
    pub fn seek_to_ms(&self, ms: u64) {
        let rate = self.sample_rate.load(Ordering::Relaxed);
        if rate > 0 {
            self.frames.store(ms * rate / 1000, Ordering::Relaxed);
        }
    }
    pub fn set_playing(&self, playing: bool) {
        self.playing.store(playing, Ordering::Relaxed);
    }
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Relaxed) as u32
    }
}

pub type SharedClock = Arc<Clock>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    /// 真实 B 站 DASH 音轨的解码验证。
    /// fixture 是本地产物（testdata/ 已 gitignore），缺失时跳过而不是失败。
    #[test]
    fn 能解码真实_b_站音轨() {
        let path = std::path::Path::new("../../testdata/sample.m4s");
        if !path.exists() {
            eprintln!("跳过：没有 testdata/sample.m4s");
            return;
        }
        let file = File::open(path).expect("fixture 应该能打开");
        let audio = decode_all(Media::new(file)).expect("symphonia 应该能解 fMP4 AAC");

        println!(
            "解码成功：{} Hz，{} 声道，{} 帧，{} ms",
            audio.sample_rate,
            audio.channels,
            audio.frames(),
            audio.duration_ms()
        );
        assert!(audio.sample_rate >= 44_100, "采样率应该至少 44.1k");
        assert!(audio.channels >= 1);
        assert!(audio.duration_ms() > 60_000, "这首 5 分 17 秒，应该解出超过 60 秒");
        assert!(
            audio.samples.iter().any(|s| *s != 0.0),
            "样本不该全是静音"
        );
    }

    #[test]
    fn 时钟只由帧数推算位置() {
        let clock = Clock::default();
        clock.reset(48_000);
        clock.advance(48_000);
        assert_eq!(clock.position_ms(), 1000);
        clock.advance(24_000);
        assert_eq!(clock.position_ms(), 1500);
    }
}
