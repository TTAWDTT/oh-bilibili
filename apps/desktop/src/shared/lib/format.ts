export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '0:00'
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatDuration(ms: number | null): string {
  return ms === null ? '--:--' : formatTime(ms)
}

export function formatSpan(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total} 秒`
  if (total < 3600) {
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
  }
  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`
}

/** 没有封面主色可用时，用 key 推一个稳定的色相，保证同一首歌的光晕不会跳。 */
export function hueFor(seed: string): number {
  let hash = 7
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 53 + seed.charCodeAt(index)) % 360
  }
  return (hash + 168) % 360
}

export function initials(title: string): string {
  const trimmed = title.trim()
  return trimmed.length === 0 ? '♪' : trimmed.slice(0, 1)
}
