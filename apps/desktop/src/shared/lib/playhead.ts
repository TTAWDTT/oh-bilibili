/**
 * 播放位置的真值在声卡侧，UI 只有 10Hz 级别的投影。把最后一次快照当作锚点，
 * 播放中按单调时钟外推，进度条和歌词才不会一格一格地跳。
 */
type Anchor = { position: number; at: number; playing: boolean; duration: number }

let anchor: Anchor = { position: 0, at: performance.now(), playing: false, duration: 0 }

/**
 * 事件从采样到到达前端的延迟估计，取观测到的最小值。
 *
 * 主线程一卡，Progress 事件就会晚到几十上百毫秒；照原样当锚点，
 * 歌词就会整体滞后于声音——这正是「音画不同步」的来源。
 * 用最小值当基线，把「已经过去的时间」补回去。
 */
let latencyBaseline = Number.POSITIVE_INFINITY

export function syncPlayhead(
  position: number,
  playing: boolean,
  duration: number,
  sentAtMs?: number,
): void {
  const now = performance.now()
  let corrected = position
  if (typeof sentAtMs === 'number') {
    // 引擎采样时刻 → 现在的间隔，减去基线就是这次事件晚到的时间
    const age = sentAtMs - lastEngineSampleAt
    latencyBaseline = Math.min(latencyBaseline, Math.max(0, age))
    const late = age - latencyBaseline
    if (playing && late > 0 && late < 2000) corrected = position + late
    lastEngineSampleAt = sentAtMs
  }
  anchor = { position: corrected, at: now, playing, duration }
}

/** 上一次快照里的引擎采样时刻，用来算事件之间的间隔。 */
let lastEngineSampleAt = 0

export function readPlayhead(): number {
  if (!anchor.playing) return anchor.position
  const elapsed = performance.now() - anchor.at
  const next = anchor.position + elapsed
  return anchor.duration > 0 ? Math.min(next, anchor.duration) : next
}
