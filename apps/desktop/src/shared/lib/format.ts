export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 时长格式化。一小时以内是 `m:ss`；超过一小时补成 `h:mm:ss`，
 * 和 B 站一致——长视频显示成 `6435:51` 那种分钟数读不出长度。
 */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '0:00'
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${minutes}:${ss}`
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

/**
 * 播放量、点赞数这类大数的口语写法。
 *
 * 原来 TrackGrid 与 AuthorView 各写了一份，第三处要用时才发现是两份实现。
 * B 站的说法是「1.1亿」「8.3万」。
 */
export function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(n)
}

/**
 * 投稿日期。B 站视频页写 `2025-03-12`；只有当年才省掉年份。
 * 输入是 Unix 秒。
 */
export function formatDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return ''
  const d = new Date(unixSeconds * 1000)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  if (d.getFullYear() === new Date().getFullYear()) return `${month}-${day}`
  return `${d.getFullYear()}-${month}-${day}`
}

/** 评论时间。B 站的口语写法：刚刚 / N 分钟前 / N 小时前 / N 天前，再往前后退到日期。 */
export function formatRelative(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return ''
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)} 天前`
  return formatDate(unixSeconds)
}
