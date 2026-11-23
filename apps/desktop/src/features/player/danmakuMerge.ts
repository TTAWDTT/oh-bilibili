export type DanmakuItem = { at: number; text: string; color: string; mode: number }

export type Flight = DanmakuItem & {
  id: number
  lane: number
  until: number
  repeats: number[]
}

const MERGE_WINDOW_MS = 2000
export const PINNED_MS = 4000

/** 先按源记录分组，再分配车道。某条未能上屏，不会改变后续同句的两秒窗口。 */
export function scheduleDanmaku(items: DanmakuItem[], merge: boolean, lanes: number, life: number): Flight[] {
  const entries: Flight[] = []
  const groups = new Map<string, Flight>()
  const freeAt = new Array<number>(lanes).fill(-Infinity)
  for (const [id, item] of [...items].sort((a, b) => a.at - b.at).entries()) {
    const key = merge && item.mode === 1 ? `${item.color}\u0000${item.text}` : null
    const group = key === null ? undefined : groups.get(key)
    if (group && item.at < group.at + MERGE_WINDOW_MS) {
      group.repeats.push(item.at)
      continue
    }
    const pinned = item.mode === 4 || item.mode === 5
    const lane = pinned ? -1 : freeAt.findIndex((at) => at <= item.at)
    const flight = { ...item, id, lane, until: item.at + (pinned ? PINNED_MS : life), repeats: [] as number[] }
    if (key !== null) groups.set(key, flight)
    if (lane >= 0) freeAt[lane] = item.at + life * 0.16
    if (pinned || lane >= 0) entries.push(flight)
  }
  return entries
}

export function visibleDanmaku(entries: Flight[], now: number, life: number): { flight: Flight; count: number }[] {
  const earliest = now - Math.max(life, PINNED_MS)
  let lo = 0, hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (entries[mid]!.at <= earliest) lo = mid + 1
    else hi = mid
  }
  const visible = []
  for (let i = lo; i < entries.length && entries[i]!.at <= now; i += 1) {
    const flight = entries[i]!
    if (flight.until <= now) continue
    let count = 1
    for (const at of flight.repeats) {
      if (at > now) break
      count += 1
    }
    visible.push({ flight, count })
  }
  return visible
}

/** 同一次本地发送和服务器回显只取一份，服务器中原有的相同记录各自保留。 */
export function withLocalEchoes(items: DanmakuItem[], sent: DanmakuItem[]): DanmakuItem[] {
  if (!sent.length) return items
  const key = (item: DanmakuItem) => JSON.stringify([item.at, item.mode, item.color, item.text])
  const unmatched = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    unmatched.set(k, (unmatched.get(k) ?? 0) + 1)
  }
  return [...items, ...sent.filter((item) => {
    const k = key(item)
    const count = unmatched.get(k) ?? 0
    if (!count) return true
    unmatched.set(k, count - 1)
    return false
  })]
}
