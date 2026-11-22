const KEY = 'oh-bilibili:recent-emote'

export type RecentEmote = {
  mid: number
  code: string
  url: string
}

type Rows = Record<string, { code: string; url: string }>

function readRows(): Rows {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Rows
  } catch {
    return {}
  }
}

function validMid(mid: number | null): mid is number {
  return mid !== null && Number.isFinite(mid) && mid > 0
}

export function readRecentEmote(mid: number | null): RecentEmote | null {
  if (!validMid(mid)) return null
  const row = readRows()[String(mid)]
  if (!row || typeof row.code !== 'string' || typeof row.url !== 'string') return null
  if (!row.code || !row.url) return null
  return { mid, code: row.code, url: row.url }
}

export function writeRecentEmote(mid: number | null, code: string, url: string): void {
  if (!validMid(mid) || !code || !url) return
  const rows = readRows()
  rows[String(mid)] = { code, url }
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    // 本地存储不可用时只是不记住，不影响这次插入。
  }
}

export function clearRecentEmote(mid: number | null): void {
  if (!validMid(mid)) return
  const rows = readRows()
  if (!(String(mid) in rows)) return
  delete rows[String(mid)]
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    // 读不到也删不掉时保持原样，下次校验还会把它当无效记录。
  }
}
