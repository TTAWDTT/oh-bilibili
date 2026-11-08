/**
 * 播放位置的真值在声卡侧，UI 只有 10Hz 级别的投影。把最后一次快照当作锚点，
 * 播放中按单调时钟外推，进度条和歌词才不会一格一格地跳。
 */
type Anchor = { position: number; at: number; playing: boolean; duration: number }

let anchor: Anchor = { position: 0, at: performance.now(), playing: false, duration: 0 }

export function syncPlayhead(position: number, playing: boolean, duration: number): void {
  anchor = { position, at: performance.now(), playing, duration }
}

export function readPlayhead(): number {
  if (!anchor.playing) return anchor.position
  const elapsed = performance.now() - anchor.at
  const next = anchor.position + elapsed
  return anchor.duration > 0 ? Math.min(next, anchor.duration) : next
}
