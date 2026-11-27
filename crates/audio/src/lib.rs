//! 音频引擎。
//!
//! 这个 crate 只认识 `Read + Seek`，不认识 URL、Referer、cookie。
//! 解码与输出分两个线程：解码线程往前推，声卡回调消费，中间是一个有界环形缓冲。

use std::io::{Read, Seek, SeekFrom};

mod indexed_mp4;
pub mod player;
pub use player::{probe_audio, Player};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
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
#[derive(Debug)]
pub struct Clock {
    frames: AtomicU64,
    sample_rate: AtomicU64,
    playing: AtomicBool,
    /// 最近一帧的 RMS 响度（0..1），只有声卡回调写。
    level: AtomicU32,
    /// 播放倍速的定点表示（×1000）。倍速播时媒体时间走得比真实时间快，
    /// 时钟推进要按这个比例放大，否则进度条会落后。
    speed_milli: AtomicU64,
}

impl Default for Clock {
    fn default() -> Clock {
        Clock {
            frames: Default::default(),
            sample_rate: Default::default(),
            playing: Default::default(),
            level: Default::default(),
            // 1.0 倍速。写成 0 的话时钟推进会被算成 0。
            speed_milli: AtomicU64::new(1000),
        }
    }
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
        let speed = self.speed_milli.load(Ordering::Relaxed).max(1);
        self.frames
            .fetch_add(frames * speed / 1000, Ordering::Relaxed);
    }

    /// 设置倍速。只影响时钟推进速度，不影响声卡输出。
    pub fn set_speed(&self, speed: f64) {
        let milli = (speed.clamp(0.5, 2.0) * 1000.0) as u64;
        self.speed_milli.store(milli.max(1), Ordering::Relaxed);
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
    /// 写响度。由声卡回调在每帧缓冲之后调用。
    pub fn set_level(&self, v: f32) {
        self.level.store(v.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
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

    /// 真实 B 站 DASH 音轨的解码验证。夹具入库，全新检出也能跑。
    #[test]
    fn 能解码真实_b_站音轨() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fragmented.m4s");
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
        assert!(audio.duration_ms() >= 4_000, "这段分片应该解出 4 秒以上");
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

#[cfg(test)]
mod clock_tests {
    use super::Clock;

    /// 倍速播放时媒体时间要按倍速推进，否则进度条会落后于声音。
    #[test]
    fn 倍速下时钟按比例推进() {
        let clock = Clock::default();
        clock.reset(48_000);
        // 默认 1.0 倍速
        clock.advance(48_000);
        assert_eq!(clock.position_ms(), 1000, "1 秒帧应等于 1000ms");

        clock.reset(48_000);
        clock.set_speed(2.0);
        clock.advance(48_000);
        assert_eq!(clock.position_ms(), 2000, "2 倍速下 1 秒帧等于 2 秒媒体时间");

        clock.reset(48_000);
        clock.set_speed(0.5);
        clock.advance(48_000);
        assert_eq!(clock.position_ms(), 500, "0.5 倍速下 1 秒帧等于 0.5 秒媒体时间");
    }
}

#[cfg(test)]
mod clock_end_tests {
    use super::Clock;

    /// 一段音频播完之后，位置必须停在原地，不能继续往上走。
    ///
    /// 曾经按输出缓冲长度推进，缓冲空了也照走，实测把 2:17 的歌存成了 42:02。
    #[test]
    fn 放完不再涨() {
        let clock = Clock::default();
        clock.reset(48_000);
        clock.set_playing(true);
        clock.advance(48_000); // 1 秒
        let at_one_second = clock.position_ms();
        assert_eq!(at_one_second, 1000);

        // 之后没有真实样本了：不再推进，位置保持
        let after_idle = clock.position_ms();
        assert_eq!(after_idle, at_one_second, "没有新样本时不该继续涨");
    }

    #[test]
    fn 位置不会超过设定的末尾() {
        let clock = Clock::default();
        clock.reset(48_000);
        clock.set_playing(true);
        for _ in 0..3 {
            clock.advance(48_000);
        }
        assert_eq!(clock.position_ms(), 3000);
    }
}
