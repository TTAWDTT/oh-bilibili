//! 编排层。
//!
//! 这个 crate 拥有四条状态机、队列和歌词，是 UI 唯一的对手。
//! 它不直接拼 B 站 URL，也不直接写 SQL 字符串。

pub mod tickets;
pub mod engine;
pub mod lyrics;
pub mod state;
pub mod wire;

pub use engine::Engine;
pub use lyrics::{LyricDoc, LyricLine};
pub use state::{Fault, LoadToken, PlayerState, Prepared, Queue, QueueEntry};
pub use wire::{AppEvent, AuthSnapshot, AuthUser, PlayerSnapshot, QueueView, WireError};
