//! 播放引擎：解码线程 + 声卡输出。
//!
//! 声卡回调在自己的线程上，解码在另一个线程上，中间是一个无锁环形缓冲。
//! 位置由回调按帧数推进，是全应用唯一的时间真值。

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
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
/// 音频侧追迹。只在设置 `BILIMUSIC_AUDIO_TRACE` 时打印，
/// 平时安静；排查「位置不动」这类问题时打开就能看到解码线程为什么停。
fn trace(message: &str) {
    if std::env::var_os("BILIMUSIC_AUDIO_TRACE").is_some() {
        eprintln!("[audio] {message}");
    }
}

fn advance_played(clock: &Clock, written_samples: usize, channels: usize) {
    if channels == 0 {
        return;
    }
    let frames = (written_samples / channels) as u64;
    if frames > 0 {
        clock.advance(frames);
    }
}

/// 当前这一次加载的播放生命周期。
///
/// `started` 只有在声卡真的取走第一批样本后才成立；`ended` 只有在解码器
/// 已经读完、环形缓冲也排空后才成立。两个条件都不看墙钟或位置数字。
#[derive(Default)]
struct Lifecycle {
    armed: AtomicBool,
    started: AtomicBool,
    eof_pending: AtomicBool,
    ended: AtomicBool,
    failed: AtomicBool,
    paused: AtomicBool,
}

impl Lifecycle {
    fn reset_load(&self) {
        self.armed.store(false, Ordering::Release);
        self.started.store(false, Ordering::Release);
        self.eof_pending.store(false, Ordering::Release);
        self.ended.store(false, Ordering::Release);
        self.failed.store(false, Ordering::Release);
    }

    fn clear_eof(&self) {
        self.eof_pending.store(false, Ordering::Release);
        self.ended.store(false, Ordering::Release);
    }

    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Release);
    }

    fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Acquire)
    }

    fn mark_started(&self, written: usize) {
        if written > 0 && self.armed.load(Ordering::Acquire) && !self.is_paused() {
            self.started.store(true, Ordering::Release);
        }
    }

    fn arm(&self) {
        self.armed.store(true, Ordering::Release);
    }

    fn mark_eof(&self) {
        self.eof_pending.store(true, Ordering::Release);
    }

    /// 声卡回调在每次 pop 之后调用。返回值表示这一次真的播完了。
    fn on_output(&self, written: usize) -> bool {
        if written > 0 {
            self.mark_started(written);
            return false;
        }
        if self.eof_pending.swap(false, Ordering::AcqRel) {
            self.ended.store(true, Ordering::Release);
            return true;
        }
        false
    }

    fn mark_failed(&self) {
        self.failed.store(true, Ordering::Release);
    }

    fn is_started(&self) -> bool {
        self.started.load(Ordering::Acquire)
    }

    fn failed(&self) -> bool {
        self.failed.load(Ordering::Acquire)
    }

    fn peek_ended(&self) -> bool {
        self.ended.load(Ordering::Acquire)
    }

    fn take_ended(&self) -> bool {
        self.ended.swap(false, Ordering::AcqRel)
    }
}

/// 让声卡回调丢弃环形缓冲里还没播的旧样本。
///
/// 回调线程是唯一持有消费者的一端，所以用代际号握手：解码线程先请求、
/// 等回调确认清空后再从新位置解码。否则 seek 之后会先响几秒旧位置的音频，
/// 画面却已经跳走了。
fn request_flush(requested: &AtomicU64, done: &AtomicU64) {
    let next = requested.fetch_add(1, Ordering::AcqRel) + 1;
    // 回调通常十毫秒级就会跑一次；设备异常时不能把命令线程永远挂在这里。
    for _ in 0..100 {
        if done.load(Ordering::Acquire) >= next {
            return;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    eprintln!("清空音频缓冲超时");
}

pub struct Player {
    tx: Sender<Cmd>,
    clock: SharedClock,
    volume_bits: Arc<AtomicU32>,
    lifecycle: Arc<Lifecycle>,
    device_rate: u32,
    _thread: JoinHandle<()>,
}

impl Player {
    pub fn start() -> Result<Player, AudioError> {
        let clock: SharedClock = Arc::new(Clock::default());
        let volume_bits = Arc::new(AtomicU32::new(0.7f32.to_bits()));
        let lifecycle = Arc::new(Lifecycle::default());
        let (tx, rx) = channel();
        let (ready_tx, ready_rx) = channel::<Result<u32, AudioError>>();

        let thread_clock = clock.clone();
        let thread_lifecycle = lifecycle.clone();
        let thread_volume = volume_bits.clone();
        let handle = std::thread::Builder::new()
            .name("bilimusic-audio".into())
            .spawn(move || {
                run_engine(rx, thread_clock, thread_volume, thread_lifecycle, ready_tx);
            })
            .map_err(|e| AudioError::Device(e.to_string()))?;

        let device_rate = ready_rx
            .recv()
            .map_err(|e| AudioError::Device(e.to_string()))??;

        Ok(Player {
            tx,
            clock,
            volume_bits,
            lifecycle,
            device_rate,
            _thread: handle,
        })
    }

    pub fn clock(&self) -> SharedClock {
        self.clock.clone()
    }

    /// 立即把共享时钟归零。切歌开始到新流加载完成之间，旧时钟还会被
    /// 上层快照读到，先归零才不会把上一条的位置显示到新视频上。
    pub fn reset_clock(&self) {
        self.clock.reset(self.device_rate);
    }

    /// 取走「自然播放到结尾」标记。
    pub fn take_ended(&self) -> bool {
        self.lifecycle.take_ended()
    }

    /// 只看不清，供「是不是卡住」的判断用。
    pub fn peek_ended(&self) -> bool {
        self.lifecycle.peek_ended()
    }

    /// 当前这一次加载是否已经开始向声卡输出样本。
    pub fn is_started(&self) -> bool {
        self.lifecycle.is_started()
    }

    /// 解码器是否没打开成功。用于把 loading 从永久等待里救出来。
    pub fn load_failed(&self) -> bool {
        self.lifecycle.failed()
    }

    pub fn device_rate(&self) -> u32 {
        self.device_rate
    }

    pub fn load(&self, media: Media) -> Result<(), AudioError> {
        self.lifecycle.reset_load();
        self.tx
            .send(Cmd::Load(media))
            .map_err(|_| AudioError::Device("音频线程已退出".into()))
    }
    pub fn play(&self) {
        self.lifecycle.set_paused(false);
        let _ = self.tx.send(Cmd::Play);
    }
    pub fn pause(&self) {
        self.lifecycle.set_paused(true);
        let _ = self.tx.send(Cmd::Pause);
    }
    pub fn stop(&self) {
        self.lifecycle.set_paused(false);
        self.lifecycle.reset_load();
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
    lifecycle: Arc<Lifecycle>,
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
    let flush_requested = Arc::new(AtomicU64::new(0));
    let flush_done = Arc::new(AtomicU64::new(0));

    let cb_clock = clock.clone();
    let cb_volume = volume_bits.clone();
    let cb_lifecycle = lifecycle.clone();
    let cb_flush_requested = flush_requested.clone();
    let cb_flush_done = flush_done.clone();
    let stream = device.build_output_stream(
        config,
        move |out: &mut [f32], _| {
            let requested = cb_flush_requested.load(Ordering::Acquire);
            if cb_flush_done.load(Ordering::Relaxed) != requested {
                consumer.clear();
                cb_flush_done.store(requested, Ordering::Release);
            }
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
            if cb_lifecycle.on_output(written) {
                cb_clock.set_playing(false);
            }
            for s in out.iter_mut().take(written) {
                *s *= gain;
            }
            for s in out.iter_mut().skip(written) {
                *s = 0.0;
            }
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
            advance_played(&cb_clock, written, channels);
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
    let mut at_eof = false;
    let mut resampler = LinearResampler::new(device_rate as f64, channels);
    // 倍速通过缩放重采样率实现：1.5 倍速就是让解码输出按 1.5 倍速被消费。
    let mut base_rate: f64 = device_rate as f64;
    let mut speed: f64 = 1.0;

    loop {
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                Cmd::Load(media) => {
                    // 旧曲目还可能在环里，换曲先清掉，别让上一首的尾巴接着响。
                    request_flush(&flush_requested, &flush_done);
                    lifecycle.reset_load();
                    at_eof = false;
                    match open_decoder(media) {
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
                            lifecycle.arm();
                            clock.reset(device_rate);
                            clock.set_playing(!lifecycle.is_paused());
                            trace("已加载并开始推进");
                            decoder = Some(d);
                        }
                        Err(e) => {
                            eprintln!("打开媒体失败: {e}");
                            lifecycle.mark_failed();
                            clock.set_playing(false);
                            decoder = None;
                        }
                    }
                }
                Cmd::SetSpeed(next) => {
                    // 0.5..=2.0，超出范围夹住；0 或负数会让重采样除零
                    speed = next.clamp(0.5, 2.0);
                    resampler.set_source_rate(base_rate * speed);
                }
                Cmd::Play => {
                    lifecycle.set_paused(false);
                    if !lifecycle.peek_ended() {
                        clock.set_playing(true);
                    }
                }
                Cmd::Pause => {
                    lifecycle.set_paused(true);
                    clock.set_playing(false);
                }
                Cmd::Seek(ms) => {
                    if let Some(d) = decoder.as_mut() {
                        at_eof = false;
                        lifecycle.clear_eof();
                        request_flush(&flush_requested, &flush_done);
                        let target = SeekTo::Time {
                            time: Time::from(ms as f64 / 1000.0),
                            track_id: Some(d.track_id),
                        };
                        match d.format.seek(SeekMode::Accurate, target) {
                            Ok(_) => {
                                clock.seek_to_ms(ms);
                                resampler.set_source_rate(base_rate * speed);
                                if !lifecycle.is_paused() {
                                    clock.set_playing(true);
                                }
                            }
                            Err(e) => eprintln!("seek 失败: {e}"),
                        }
                    }
                }
                Cmd::Stop => {
                    request_flush(&flush_requested, &flush_done);
                    lifecycle.set_paused(false);
                    lifecycle.reset_load();
                    decoder = None;
                    at_eof = false;
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

        if at_eof {
            std::thread::sleep(Duration::from_millis(8));
            continue;
        }

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
                // 自然播到末尾：这是「该切歌」的信号
                trace(&format!("EOF，位置 {}ms", clock.position_ms()));
                lifecycle.mark_eof();
                at_eof = true;
                continue;
            }
            Err(err) => {
                // 已起播的读错误交给看门狗续播；首批样本前失败则直接报错，
                // 否则引擎会永远停在 loading。
                trace(&format!("解码错误 {err}，位置 {}ms", clock.position_ms()));
                if !lifecycle.is_started() {
                    lifecycle.mark_failed();
                }
                clock.set_playing(false);
                decoder = None;
                at_eof = false;
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
                if !lifecycle.is_started() {
                    lifecycle.mark_failed();
                }
                clock.set_playing(false);
                decoder = None;
                at_eof = false;
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
mod resampler_tests {
    use super::{Consumer, HeapRb, LinearResampler, Split};

    #[test]
    fn 单声道每帧应写入双声道() {
        let (mut producer, mut consumer) = HeapRb::<f32>::new(8).split();
        let mut resampler = LinearResampler::new(48_000.0, 2);

        resampler.push(&[0.25, -0.5, 0.75], &mut producer);

        let mut output = [0.0; 8];
        assert_eq!(consumer.pop_slice(&mut output), 6);
        assert_eq!(output[..6], [0.25, 0.25, -0.5, -0.5, 0.75, 0.75]);
    }

    #[test]
    fn 双声道保持每帧的左右样本() {
        let (mut producer, mut consumer) = HeapRb::<f32>::new(8).split();
        let mut resampler = LinearResampler::new(48_000.0, 2);
        let input = [0.25, -0.5, 0.75, -1.0];

        resampler.push(&input, &mut producer);

        let mut output = [0.0; 8];
        assert_eq!(consumer.pop_slice(&mut output), 4);
        assert_eq!(output[..4], input);
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

#[cfg(test)]
mod lifecycle_tests {
    use super::Lifecycle;

    #[test]
    fn 首批样本前不算起播() {
        let lifecycle = Lifecycle::default();
        lifecycle.reset_load();
        lifecycle.arm();
        assert!(!lifecycle.is_started());
        assert!(!lifecycle.on_output(0));
        assert!(!lifecycle.is_started());
        lifecycle.on_output(960);
        assert!(lifecycle.is_started());
    }

    #[test]
    fn 换曲过程中旧缓冲不算新曲起播() {
        let lifecycle = Lifecycle::default();
        lifecycle.reset_load();
        lifecycle.on_output(960);
        assert!(!lifecycle.is_started(), "新曲还没 arm，旧样本不能起播");
        lifecycle.arm();
        lifecycle.on_output(960);
        assert!(lifecycle.is_started());
    }

    #[test]
    fn 解码结束后要等缓冲排空() {
        let lifecycle = Lifecycle::default();
        lifecycle.reset_load();
        lifecycle.arm();
        lifecycle.on_output(960);
        lifecycle.mark_eof();
        assert!(!lifecycle.peek_ended(), "还有缓冲时不能报结束");
        assert!(!lifecycle.on_output(960), "排空缓冲的最后一批仍是播放");
        assert!(!lifecycle.peek_ended());
        assert!(lifecycle.on_output(0), "缓冲真正空了才报结束");
        assert!(lifecycle.peek_ended());
    }

    #[test]
    fn 换曲会清掉上一轮的起播与结束() {
        let lifecycle = Lifecycle::default();
        lifecycle.reset_load();
        lifecycle.arm();
        lifecycle.on_output(960);
        lifecycle.mark_eof();
        lifecycle.on_output(0);
        assert!(lifecycle.peek_ended());
        lifecycle.reset_load();
        assert!(!lifecycle.is_started());
        assert!(!lifecycle.peek_ended());
        assert!(!lifecycle.failed());
    }

    #[test]
    fn 暂停时取走样本也不算起播() {
        let lifecycle = Lifecycle::default();
        lifecycle.reset_load();
        lifecycle.arm();
        lifecycle.set_paused(true);
        lifecycle.on_output(960);
        assert!(!lifecycle.is_started());
        lifecycle.set_paused(false);
        lifecycle.on_output(960);
        assert!(lifecycle.is_started());
    }
}
