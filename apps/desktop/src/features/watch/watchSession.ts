import type { SeasonEpisodeView, Track } from '../../shared/lib/contract'

/**
 * 一次「连续观看」的片单上下文。
 *
 * 只活在当前进程里：退出观看、切到普通视频或离开播放器都会清掉，
 * 不影响账号里的稍后再看清单本身。
 */
export type WatchSession = {
  label: string
  items: Track[]
  /** 当前条目在 items 里的下标；结束后指向 items.length。 */
  index: number
  /** 本次会话里失败的条目，跳过只影响这一次。 */
  skipped: Set<string>
}

let session: WatchSession | null = null

export function startWatchSession(items: Track[], index: number, label = '待看片单'): void {
  session =
    items.length === 0 || index < 0 || index >= items.length
      ? null
      : { label, items, index, skipped: new Set() }
}

/** 正在播放的这条属于这次片单时返回它，否则为空。 */
export function currentWatchSession(key: string): WatchSession | null {
  return session && session.items[session.index]?.key === key ? session : null
}

/** 下一条没被跳过的条目；不改变会话状态，只用于界面预告。 */
export function peekWatchSessionNext(key: string): Track | null {
  if (!session) return null
  const from = session.items.findIndex((item) => item.key === key)
  if (from < 0) return null
  return nextAfter(from)
}

export function followingWatchTracks(key: string, episodes: SeasonEpisodeView[], owner: string): Track[] | null {
  const current = currentWatchSession(key)
  if (current) return current.items.slice(current.index + 1).filter((item) => !current.skipped.has(item.key))
  const index = episodes.findIndex((entry) => entry.key === key)
  if (index < 0) return null
  return episodes.slice(index + 1).map((entry) => ({
    key: entry.key, title: entry.title, artist: owner, cover: entry.cover,
    duration_ms: entry.duration_ms || null, views: entry.views,
  }))
}

/** 走到下一条并把它记为当前条目。 */
export function advanceWatchSession(key: string): Track | null {
  if (!session) return null
  const from = session.items.findIndex((item) => item.key === key)
  if (from < 0) return null
  const next = nextAfter(from)
  if (!next) return null
  session.index = session.items.indexOf(next)
  return next
}

/** 跳过当前条目；返回下一条，没有就结束这次会话。 */
export function skipWatchSession(key: string): Track | null {
  if (!session) return null
  session.skipped.add(key)
  return advanceWatchSession(key)
}

export function endWatchSession(): void {
  session = null
}

function nextAfter(from: number): Track | null {
  if (!session) return null
  for (let i = from + 1; i < session.items.length; i += 1) {
    const item = session.items[i]
    if (!item || session.skipped.has(item.key)) continue
    return item
  }
  return null
}
