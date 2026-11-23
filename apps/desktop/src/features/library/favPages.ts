import type { Track } from '../../shared/lib/contract'

export type CollectOptions = {
  /** 目录里写的总数；可能过期，只当参考。 */
  expected?: number | null
  pageSize?: number
  maxPages?: number
  /** 用户取消或切夹：每取完一页检查一次。 */
  stopped?: () => boolean
  onProgress?: (loaded: number, page: number) => void
}

export type CollectResult = { tracks: Track[]; complete: boolean }

/**
 * 把收藏夹的所有页读完再交给播放器。
 *
 * 结束条件按可靠性排序：取消、空页、达到目录总数、整页没有新作品。
 * 数量过期或页间重复时不会无限翻；读不全时 `complete` 为 false，
 * 由调用方说明实际范围，或者不开始播放。
 */
export async function collectFavTracks(
  fetchPage: (page: number) => Promise<Track[]>,
  { expected = null, pageSize = 40, maxPages = 50, stopped, onProgress }: CollectOptions = {},
): Promise<CollectResult> {
  const seen = new Set<string>()
  const tracks: Track[] = []
  let page = 1
  while (page <= maxPages) {
    const list = await fetchPage(page)
    if (stopped?.()) return { tracks, complete: false }
    if (list.length === 0) return { tracks, complete: true }
    let added = 0
    for (const track of list) {
      if (seen.has(track.key)) continue
      seen.add(track.key)
      tracks.push(track)
      added += 1
    }
    onProgress?.(tracks.length, page)
    if (expected !== null && expected > 0 && tracks.length >= expected) {
      return { tracks, complete: true }
    }
    // 一整页都是见过的作品：再翻也只会重复，停下并把「没读全」交给调用方处理。
    if (added === 0) return { tracks, complete: false }
    // B 站最后一页不满 40 条；目录总数可信时再核对一次。
    if (list.length < pageSize) {
      return { tracks, complete: expected === null || expected <= 0 || tracks.length >= expected }
    }
    page += 1
  }
  return { tracks, complete: false }
}
