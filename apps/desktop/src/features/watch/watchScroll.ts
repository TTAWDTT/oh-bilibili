/** 从观看页点进作者空间时记下阅读位置；返回同一 BV 时恢复一次。 */
const positions = new Map<string, number>()

export function rememberWatchScroll(key: string): void {
  const top = document.getElementById('scroll-main')?.scrollTop ?? 0
  positions.set(key, top)
}

export function takeWatchScroll(key: string): number | null {
  const top = positions.get(key)
  if (top === undefined) return null
  positions.delete(key)
  return top
}
