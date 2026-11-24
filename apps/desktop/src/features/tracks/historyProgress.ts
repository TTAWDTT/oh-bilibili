import type { HistoryEntry } from '../../shared/lib/ipc'
import { knownPageCount } from './pageSpineLabel'

export type HistoryProgress = { page: number; position: number; duration: number }

export function historyProgress(entry: HistoryEntry, watch?: HistoryProgress | null): HistoryProgress {
  if (entry.page_no == null) {
    const legacy = watch === undefined ? readWatchProgress(entry.track.key) : watch
    if (legacy) return legacy
  }
  const page = entry.page_no ?? 1
  const multi = page > 1 || (knownPageCount(entry.track.key, entry.track.pages) ?? 0) > 1
  return {
    page,
    position: entry.position_ms,
    duration: entry.page_duration_ms ?? (entry.page_no != null && multi ? 0 : entry.track.duration_ms ?? 0),
  }
}

/** 观看页把分 P 进度写在本地；有这份记录才敢说这是「看过的视频」。 */
export function readWatchProgress(key: string): HistoryProgress | null {
  const read = (page: number) => {
    const rawPosition = localStorage.getItem(`oh-bilibili:watch-pos:${key}:${page}`)
    if (rawPosition === null) return null
    const position = Number(rawPosition)
    const duration = Number(localStorage.getItem(`oh-bilibili:watch-len:${key}:${page}`))
    return {
      page,
      position: Number.isFinite(position) ? position : 0,
      duration: Number.isFinite(duration) ? duration : 0,
    }
  }
  try {
    const stored = Number(localStorage.getItem(`oh-bilibili:watch-page:${key}`))
    if (Number.isInteger(stored) && stored > 0) return read(stored)
    const prefix = `oh-bilibili:watch-pos:${key}:`
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i)
      if (!name?.startsWith(prefix)) continue
      const page = Number(name.slice(prefix.length))
      if (Number.isInteger(page) && page > 0) return read(page)
    }
  } catch {
    // 隐私模式读不到，按「听」处理
  }
  return null
}
