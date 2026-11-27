use std::io::{Cursor, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use symphonia::core::formats::{SeekMode, SeekTo};
use symphonia::core::units::Time;

use super::{open_decoder, Media};

struct CountingMedia {
    data: Cursor<Vec<u8>>,
    bytes_read: Arc<AtomicUsize>,
}

impl Read for CountingMedia {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let count = self.data.read(buf)?;
        self.bytes_read.fetch_add(count, Ordering::Relaxed);
        Ok(count)
    }
}

impl Seek for CountingMedia {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.data.seek(pos)
    }
}

// Extend the checked-in Bilibili clip by reusing its actual AAC packets and
// constructing the same leading sidx found in full-length DASH audio.
fn long_bilibili_fixture() -> Vec<u8> {
    const CLIP: &[u8] = include_bytes!("../tests/fixtures/fragmented.m4s");
    const SEGMENTS: u16 = 720;
    const CLIP_TICKS: u32 = 239_608;
    let moof = CLIP.windows(4).position(|word| word == b"moof").unwrap() - 4;
    let mut fragment = CLIP[moof..].to_vec();
    let field = |name: &[u8; 4]| fragment.windows(4).position(|word| word == name).unwrap() + 8;
    let sequence_number = field(b"mfhd");
    let decode_time = field(b"tfdt");
    let mut media = CLIP[..moof].to_vec();
    media.extend_from_slice(&(32 + u32::from(SEGMENTS) * 12).to_be_bytes());
    media.extend_from_slice(b"sidx");
    for value in [0u32, 2, 48_000, 0, 0, u32::from(SEGMENTS)] {
        media.extend_from_slice(&value.to_be_bytes());
    }
    for _ in 0..SEGMENTS {
        for value in [fragment.len() as u32, CLIP_TICKS, 0x9000_0000] {
            media.extend_from_slice(&value.to_be_bytes());
        }
    }
    for n in 0..u32::from(SEGMENTS) {
        fragment[sequence_number..sequence_number + 4].copy_from_slice(&(n + 1).to_be_bytes());
        fragment[decode_time..decode_time + 4].copy_from_slice(&(n * CLIP_TICKS).to_be_bytes());
        media.extend_from_slice(&fragment);
    }
    media
}

fn open_counted() -> (super::Session, Arc<AtomicUsize>, usize) {
    let data = long_bilibili_fixture();
    let size = data.len();
    let bytes_read = Arc::new(AtomicUsize::new(0));
    let start = Instant::now();
    let session = open_decoder(
        Media::new(CountingMedia {
            data: Cursor::new(data),
            bytes_read: bytes_read.clone(),
        }),
        false,
    )
    .unwrap();
    println!(
        "open: {} of {size} bytes in {:?}",
        bytes_read.load(Ordering::Relaxed),
        start.elapsed()
    );
    (session, bytes_read, size)
}

#[test]
fn indexed_bilibili_opens_without_reading_through_the_track() {
    let (mut session, bytes_read, size) = open_counted();
    let packet = session.format.next_packet().unwrap();
    assert_eq!(packet.ts(), 0);
    assert!(session.decoder.decode(&packet).is_ok());
    assert!(bytes_read.load(Ordering::Relaxed) < size / 100);
}

#[test]
fn indexed_bilibili_seeks_to_the_first_requested_packet() {
    let (mut session, bytes_read, size) = open_counted();
    bytes_read.store(0, Ordering::Relaxed);
    let start = Instant::now();
    let seeked = session
        .format
        .seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::from(3300.0),
                track_id: Some(session.track_id),
            },
        )
        .unwrap();
    let packet = session.format.next_packet().unwrap();
    let read = bytes_read.load(Ordering::Relaxed);
    println!(
        "seek: {read} of {size} bytes in {:?}, packet at {}",
        start.elapsed(),
        packet.ts()
    );
    assert!(seeked.required_ts - seeked.actual_ts < packet.dur());
    assert_eq!(packet.ts(), seeked.actual_ts);
    assert!(session.decoder.decode(&packet).is_ok());
    assert!(read < size / 100);
}
