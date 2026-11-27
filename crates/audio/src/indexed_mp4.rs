use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use symphonia::core::formats::FormatReader;
use symphonia::core::io::MediaSource;
use symphonia::core::units::TimeBase;

use crate::AudioError;

const MAX_INIT_BYTES: usize = 1024 * 1024;

struct Segment {
    byte_offset: u64,
    tick: u64,
}

pub(super) struct SegmentIndex {
    init: Vec<u8>,
    timescale: u32,
    duration: u64,
    segments: Vec<Segment>,
}

impl SegmentIndex {
    pub(super) fn read(source: &mut dyn MediaSource) -> Option<Self> {
        let total = source.byte_len()?;
        let mut init = Vec::new();
        let mut has_ftyp = false;
        let mut has_moov = false;
        loop {
            let mut header = [0; 8];
            source.read_exact(&mut header).ok()?;
            match &header[4..] {
                b"moof" | b"mdat" => return None,
                b"ftyp" => has_ftyp = true,
                b"moov" => has_moov = true,
                _ => {}
            }

            let size = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
            let atom_start = init.len();
            let end = atom_start + size;
            if size < header.len() || end > MAX_INIT_BYTES || end as u64 > total {
                return None;
            }
            init.extend_from_slice(&header);
            let payload_start = init.len();
            init.resize(end, 0);
            source.read_exact(&mut init[payload_start..]).ok()?;
            if &header[4..] == b"sidx" {
                return (has_ftyp && has_moov)
                    .then(|| Self::from_atom(init, payload_start, total))
                    .flatten();
            }
        }
    }

    fn from_atom(init: Vec<u8>, payload_start: usize, total: u64) -> Option<Self> {
        let payload = init.get(payload_start..)?;
        let timescale = u32::from_be_bytes(payload.get(8..12)?.try_into().ok()?);
        let (first_offset, entries_start) = match *payload.first()? {
            0 if payload.get(12..16)? == [0; 4] => (
                u64::from(u32::from_be_bytes(payload.get(16..20)?.try_into().ok()?)),
                24,
            ),
            1 if payload.get(12..20)? == [0; 8] => (
                u64::from_be_bytes(payload.get(20..28)?.try_into().ok()?),
                32,
            ),
            _ => return None,
        };
        let count = usize::from(u16::from_be_bytes(
            payload
                .get(entries_start - 2..entries_start)?
                .try_into()
                .ok()?,
        ));
        let mut entries = payload.get(entries_start..)?.chunks_exact(12);
        if timescale == 0 || count == 0 || entries.len() != count || !entries.remainder().is_empty()
        {
            return None;
        }
        // Keep all original byte offsets, including any absolute offsets in tfhd.
        if (1..8).contains(&first_offset) {
            return None;
        }
        let mut byte_offset = (init.len() as u64).checked_add(first_offset)?;
        let mut duration = 0;
        let mut segments = Vec::with_capacity(count);
        for entry in &mut entries {
            let size = u32::from_be_bytes(entry[..4].try_into().unwrap());
            let ticks = u32::from_be_bytes(entry[4..8].try_into().unwrap());
            if !(8..0x8000_0000).contains(&size) || ticks == 0 {
                return None;
            }
            segments.push(Segment {
                byte_offset,
                tick: duration,
            });
            byte_offset = byte_offset.checked_add(u64::from(size))?;
            duration += u64::from(ticks);
        }
        // A leading sidx can cover just a portion of a file. Only use a complete
        // index so duration and seek still describe the whole source.
        (byte_offset == total).then_some(Self {
            init,
            timescale,
            duration,
            segments,
        })
    }
}

struct SharedSource {
    source: Mutex<Box<dyn MediaSource>>,
    total: u64,
}

pub(super) struct IndexedMp4 {
    media: Arc<SharedSource>,
    index: SegmentIndex,
}

impl IndexedMp4 {
    pub(super) fn new(source: Box<dyn MediaSource>, index: SegmentIndex) -> Self {
        let total = source.byte_len().expect("indexed MP4 has a known length");
        Self {
            media: Arc::new(SharedSource {
                source: Mutex::new(source),
                total,
            }),
            index,
        }
    }

    pub(super) fn into_source(self) -> Box<dyn MediaSource> {
        let media = Arc::into_inner(self.media).expect("no retained format while falling back");
        media.source.into_inner().unwrap()
    }

    pub(super) fn duration_ms(&self) -> u64 {
        self.index.duration * 1000 / u64::from(self.index.timescale)
    }

    pub(super) fn matches(&self, time_base: TimeBase) -> bool {
        time_base.numer == 1 && time_base.denom == self.index.timescale
    }

    pub(super) fn segment_at(&self, ts: u64) -> (usize, u64) {
        let segment = self
            .index
            .segments
            .partition_point(|segment| segment.tick <= ts)
            - 1;
        (segment, self.index.segments[segment].tick)
    }

    pub(super) fn open_at(&self, segment: usize) -> Result<Box<dyn FormatReader>, AudioError> {
        let start = self.index.segments[segment].byte_offset;
        let mut prefix = self.index.init.clone();
        let gap = start - prefix.len() as u64;
        if let Ok(size) = u32::try_from(gap) {
            if size != 0 {
                prefix.extend_from_slice(&size.to_be_bytes());
                prefix.extend_from_slice(b"free");
            }
        } else {
            prefix.extend_from_slice(b"\0\0\0\x01free");
            prefix.extend_from_slice(&gap.to_be_bytes());
        }

        let seekable = Arc::new(AtomicBool::new(false));
        let format = super::player::probe_format(Box::new(IndexedSource {
            prefix,
            start,
            seekable: seekable.clone(),
            position: 0,
            media: self.media.clone(),
        }))?;
        // Symphonia's streaming probe stops at sidx. Enable seeks for packet
        // access and for skipping the synthetic free atom after initialization.
        seekable.store(true, Ordering::Relaxed);
        Ok(format)
    }
}

struct IndexedSource {
    // The original init followed by, when seeking, a free atom in place of
    // preceding fragments. Bytes from the chosen fragment onward are unchanged.
    prefix: Vec<u8>,
    start: u64,
    seekable: Arc<AtomicBool>,
    position: u64,
    media: Arc<SharedSource>,
}

impl Read for IndexedSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let count = if self.position < self.prefix.len() as u64 {
            (&self.prefix[self.position as usize..]).read(buf)?
        } else if self.position < self.start {
            let count = (self.start - self.position).min(buf.len() as u64) as usize;
            buf[..count].fill(0);
            count
        } else {
            let mut source = self.media.source.lock().unwrap();
            source.seek(SeekFrom::Start(self.position))?;
            source.read(buf)?
        };
        self.position += count as u64;
        Ok(count)
    }
}

impl Seek for IndexedSource {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.position = match pos {
            SeekFrom::Start(offset) => Some(offset),
            SeekFrom::Current(offset) => self.position.checked_add_signed(offset),
            SeekFrom::End(offset) => self.media.total.checked_add_signed(offset),
        }
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid MP4 offset"))?;
        Ok(self.position)
    }
}

impl MediaSource for IndexedSource {
    fn is_seekable(&self) -> bool {
        self.seekable.load(Ordering::Relaxed)
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.media.total)
    }
}
