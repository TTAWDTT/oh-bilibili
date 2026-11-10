//! 播放引擎：解码线程 + 声卡输出。
//!
//! 声卡回调在自己的线程上，解码在另一个线程上，中间是一个无锁环形缓冲。
//! 位置由回调按帧数推进，是全应用唯一的时间真值。

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::HeapRb;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use crate::AudioError;
use crate::{Clock, Media, SharedClock};

/// 环形缓冲容量，按 f32 样本计。约两秒双声道。
// 4 秒缓冲（48kHz 双声道 × 4）：网络抖动时不容易欠载，
// 欠载会直接表现为声音断续和进度落后。
const RING_CAPACITY: usize = 48000 * 2 * 4;

enum Cmd {
    Load(Media),
    Play,
    Pause,
    Seek(u64),
    /// 播放倍速，0.5..=2.0。
    SetSpeed(f64),
    Stop,
    Shutdown,
}

/// 按「真的送到声卡的样本数」推进时钟。
///
/// 不能按输出缓冲长度推进：缓冲空了（歌播完或网络卡住）时那里面是静音，
/// 推进它会让位置一路涨到远超时长——实测一首 2:17 的歌被存成了 42:02。
fn advance_played(clock: &Clock, written_samples: usize, channels: usize) {
    if channels == 0 {
        return;
    }
    let frames = (written_samples / channels) as u64;
    if frames > 0 {
        clock.advance(frames);
    }
}

pub struct Player {
    tx: Sender<Cmd>,
    clock: SharedClock,
    volume_bits: Arc<AtomicU32>,
    device_rate: u32,
    _thread: JoinHandle<()>,
}

impl Player {
    pub fn start() -> Result<Player, AudioError> {
        let clock: SharedClock = Arc::new(Clock::default());
        let volume_bits = Arc::new(AtomicU32::new(0.7f32.to_bits()));
        let (tx, rx) = channel();
        let (ready_tx, ready_rx) = channel::<Result<u32, AudioError>>();

        let thread_clock = clock.clone();
        let thread_volume = volume_bits.clone();
        let handle = std::thread::Builder::new()
            .name("bilimusic-audio".into())
            .spawn(move || {
                run_engine(rx, thread_clock, thread_volume, ready_tx);
            })
            .map_err(|e| AudioError::Device(e.to_string()))?;

        let device_rate = ready_rx
            .recv()
            .map_err(|e| AudioError::Device(e.to_string()))??;

        Ok(Player {
            tx,
            clock,
            volume_bits,
            device_rate,
            _thread: handle,
        })
    }

    pub fn clock(&self) -> SharedClock {
        self.clock.clone()
    }

    pub fn device_rate(&self) -> u32 {
        self.device_rate
    }

    pub fn load(&self, media: Media) -> Result<(), AudioError> {
        self.tx
            .send(Cmd::Load(media))
            .map_err(|_| AudioError::Device("音频线程已退出".into()))
    }
    pub fn play(&self) {
        let _ = self.tx.send(Cmd::Play);
    }
    pub fn pause(&self) {
        let _ = self.tx.send(Cmd::Pause);
    }
    pub fn stop(&self) {
        let _ = self.tx.send(Cmd::Stop);
    }
    pub fn seek(&self, position_ms: u64) {
        let _ = self.tx.send(Cmd::Seek(position_ms));
    }
    /// 设置播放倍速。0.5 到 2.0，超范围会被夹住。
    pub fn set_speed(&self, speed: f64) {
        let _ = self.tx.send(Cmd::SetSpeed(speed));
    }

    pub fn set_volume(&self, v: f32) {
        self.volume_bits
            .store(v.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }
    pub fn volume(&self) -> f32 {
        f32::from_bits(self.volume_bits.load(Ordering::Relaxed))
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.tx.send(Cmd::Shutdown);
    }
}

struct Session {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
}

fn open_decoder(media: Media) -> Result<Session, AudioError> {
    let mss = MediaSourceStream::new(media.into_inner(), Default::default());
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
    let format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or(AudioError::NoTrack)?;
    let track_id = track.id;
    let decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AudioError::Decode(e.to_string()))?;

    // fMP4 把 moov 放在文件末尾，探针读完头已经在 EOF 附近，
    // 不回卷的话第一次 next_packet 直接 EOF，听起来像「点了播放没反应」。
    let mut format = format;
    let _ = format.seek(
        SeekMode::Accurate,
        SeekTo::Time {
            time: Time::from(0.0),
            track_id: Some(track_id),
        },
    );

    Ok(Session {
        format,
        decoder,
        track_id,
    })
}

fn run_engine(
    rx: Receiver<Cmd>,
    clock: SharedClock,
    volume_bits: Arc<AtomicU32>,
    ready_tx: Sender<Result<u32, AudioError>>,
) {
    let host = cpal::default_host();
    let device = match host.default_output_device() {
        Some(d) => d,
        None => {
            let _ = ready_tx.send(Err(AudioError::Device("没有可用的输出设备".into())));
            return;
        }
    };
    let supported = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            let _ = ready_tx.send(Err(AudioError::Device(e.to_string())));
            return;
        }
    };
    let device_rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.config();

    let rb = HeapRb::<f32>::new(RING_CAPACITY);
    let (mut producer, mut consumer) = rb.split();

    let cb_clock = clock.clone();
    let cb_volume = volume_bits.clone();
    let stream = device.build_output_stream(
        config,
        move |out: &mut [f32], _| {
            let gain = f32::from_bits(cb_volume.load(Ordering::Relaxed));
            // 暂停时不要再吐缓冲：环里存着最多 2 秒已解码的音频，
            // 无条件 pop 会让「点暂停」之后还继续响两秒——这就是暂停的延迟来源。
            // 缓冲保持不动，恢复时正好从这里接上。
            if !cb_clock.is_playing() {
                out.fill(0.0);
                cb_clock.set_level(0.0);
                return;
            }
            let written = consumer.pop_slice(out);
            for s in out.iter_mut().take(written) {
                *s *= gain;
            }
            for s in out.iter_mut().skip(written) {
                *s = 0.0;
            }
            // 只按「真的送到声卡的那部分」推进时钟：
            // 原先按 out.len() 推进，缓冲空了（歌播完或网络卡住）也照走，
            // 位置会一直涨到远超时长——实测一首 2:17 的歌被存成了 42:02。
            // RMS 才是「有多响」，取绝对值平均会虚高。
            if written > 0 {
                let mut sum = 0.0f32;
                for s in out.iter().take(written) {
                    sum += s * s;
                }
                cb_clock.set_level((sum / written as f32).sqrt());
            } else {
                cb_clock.set_level(0.0);
            }
            // 时钟按「声卡这一拍消费掉的时间」推进，而不是「真的有多少样本」。
            //
            // 缓冲欠载时声卡照样走时间（放的是静音），只按 written 推进会让时钟
            // 落后于真实时间——实测 20.4 秒墙钟只推进了 16 秒位置（慢 21%），
            // 歌词于是越唱越落后。播完的边界由解码线程 set_playing(false) 管。
            advance_played(&cb_clock, out.len(), channels);
        },
        |err| eprintln!("音频输出错误: {err}"),
        None,
    );

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(AudioError::Device(e.to_string())));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(AudioError::Device(e.to_string())));
        return;
    }
    let _ = ready_tx.send(Ok(device_rate));

    let mut decoder: Option<Session> = None;
    let mut resampler = LinearResampler::new(device_rate as f64, channels);
    // 倍速通过缩放重采样率实现：1.5 倍速就是让解码输出按 1.5 倍速被消费。
    let mut base_rate: f64 = device_rate as f64;
    let mut speed: f64 = 1.0;

    loop {
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                Cmd::Load(media) => match open_decoder(media) {
                    Ok(d) => {
                        let rate = d
                            .format
                            .tracks()
                            .iter()
                            .find(|t| t.id == d.track_id)
                            .and_then(|t| t.codec_params.sample_rate)
                            .unwrap_or(48_000);
                        base_rate = rate as f64;
                        resampler.set_source_rate(base_rate * speed);
                        clock.reset(device_rate);
                        clock.set_playing(true);
                        decoder = Some(d);
                    }
                    Err(e) => {
                        eprintln!("打开媒体失败: {e}");
                        clock.set_playing(false);
                        decoder = None;
                    }
                },
                Cmd::SetSpeed(next) => {
                    // 0.5..=2.0，超出范围夹住；0 或负数会让重采样除零
                    speed = next.clamp(0.5, 2.0);
                    resampler.set_source_rate(base_rate * speed);
                }
                Cmd::Play => clock.set_playing(true),
                Cmd::Pause => clock.set_playing(false),
                Cmd::Seek(ms) => {
                    if let Some(d) = decoder.as_mut() {
                        let target = SeekTo::Time {
                            time: Time::from(ms as f64 / 1000.0),
                            track_id: Some(d.track_id),
                        };
                        match d.format.seek(SeekMode::Accurate, target) {
                            Ok(_) => clock.seek_to_ms(ms),
                            Err(e) => eprintln!("seek 失败: {e}"),
                        }
                    }
                }
                Cmd::Stop => {
                    decoder = None;
                    clock.set_playing(false);
                    clock.reset(device_rate);
                }
                Cmd::Shutdown => return,
            }
        }

        if !clock.is_playing() {
            std::thread::sleep(Duration::from_millis(8));
            continue;
        }

        let Some(d) = decoder.as_mut() else {
            std::thread::sleep(Duration::from_millis(8));
            continue;
        };

        // 缓冲够满就歇一会儿，别把 CPU 烧了。
        if producer.vacant_len() < 4096 {
            std::thread::sleep(Duration::from_millis(4));
            continue;
        }

        let packet = match d.format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                clock.set_playing(false);
                decoder = None;
                continue;
            }
            Err(_) => {
                clock.set_playing(false);
                decoder = None;
                continue;
            }
        };
        if packet.track_id() != d.track_id {
            continue;
        }
        match d.decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                let capacity = decoded.capacity();
                let mut sb = symphonia::core::audio::SampleBuffer::<f32>::new(
                    capacity as u64,
                    spec,
                );
                sb.copy_interleaved_ref(decoded);
                resampler.push(sb.samples(), &mut producer);
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => {
                clock.set_playing(false);
                decoder = None;
            }
        }
    }
}

/// 线性重采样。设备采样率与内容采样率一致时是直通。
struct LinearResampler {
    source_rate: f64,
    device_rate: f64,
    channels: usize,
    pos: f64,
    tail: Vec<f32>,
}

impl LinearResampler {
    fn new(device_rate: f64, channels: usize) -> LinearResampler {
        LinearResampler {
            source_rate: device_rate,
            device_rate,
            channels,
            pos: 0.0,
            tail: Vec::new(),
        }
    }

    fn set_source_rate(&mut self, rate: f64) {
        self.source_rate = rate;
        self.pos = 0.0;
        self.tail.clear();
    }

    fn push(&mut self, samples: &[f32], producer: &mut impl Producer<Item = f32>) {
        if self.source_rate <= 0.0 || self.channels == 0 {
            return;
        }
        if (self.source_rate - self.device_rate).abs() < 0.5 {
            producer.push_slice(samples);
            return;
        }
        let step = self.source_rate / self.device_rate;

        let mut combined = std::mem::take(&mut self.tail);
        combined.extend_from_slice(samples);
        let total = combined.len() / self.channels;

        let mut out: Vec<f32> = Vec::with_capacity(((total as f64 / step) as usize + 2) * self.channels);
        let mut pos = self.pos;
        while (pos.floor() as usize) + 1 < total {
            let i = pos.floor() as usize;
            let frac = (pos - i as f64) as f32;
            for c in 0..self.channels {
                let a = combined[i * self.channels + c];
                let b = combined[(i + 1) * self.channels + c];
                out.push(a + (b - a) * frac);
            }
            pos += step;
        }
        // 留下最后一个完整帧给下一批用，保证跨包连续。
        let consumed_frames = (pos.floor() as usize).min(total);
        self.tail = combined[consumed_frames * self.channels..].to_vec();
        self.pos = pos - consumed_frames as f64;
        producer.push_slice(&out);
    }
}

#[cfg(test)]
mod advance_played_tests {
    use super::advance_played;
    use crate::Clock;

    /// 缓冲空了就是没有声音在放，位置必须停住。
    #[test]
    fn 没有样本推进为零() {
        let clock = Clock::default();
        clock.reset(48_000);
        clock.set_playing(true);
        advance_played(&clock, 0, 2);
        assert_eq!(clock.position_ms(), 0);
    }

    /// 走了多少帧就推进多少毫秒，按声道数折算。
    #[test]
    fn 按实际帧数折算毫秒() {
        let clock = Clock::default();
        clock.reset(48_000);
        clock.set_playing(true);
        // 双声道，48000 个样本 = 24000 帧 = 500ms
        advance_played(&clock, 48_000, 2);
        assert_eq!(clock.position_ms(), 500);
    }

    /// 声道数为 0 是异常输入，不能除零panic。
    #[test]
    fn 声道为零不崩() {
        let clock = Clock::default();
        clock.reset(48_000);
        advance_played(&clock, 1000, 0);
        assert_eq!(clock.position_ms(), 0);
    }
}
