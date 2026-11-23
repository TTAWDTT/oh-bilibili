import type { Track } from '../../shared/lib/contract'
import type { FavTrackPage } from '../../shared/lib/ipc'

export function appendFavPage(previous: Track[], incoming: Track[]): Track[] {
  const seen = new Set(previous.map((track) => track.key))
  const tracks = previous.slice()
  for (const track of incoming) {
    if (!seen.has(track.key)) {
      seen.add(track.key)
      tracks.push(track)
    }
  }
  return tracks
}

type CollectOptions = {
  initial?: Track[]
  fromPage?: number
  stopped?: () => boolean
  onProgress?: (tracks: Track[], page: number, complete: boolean) => void
}

/** 队列只在接口确认最后一页后提交。目录数量和过滤失效稿后的页长都不能判断结束。 */
export async function collectFavTracks(
  fetchPage: (page: number) => Promise<FavTrackPage>,
  { initial = [], fromPage = 1, stopped, onProgress }: CollectOptions = {},
): Promise<{ tracks: Track[]; complete: boolean }> {
  let tracks = initial
  let emptyPages = 0
  for (let page = fromPage; ; page += 1) {
    const result = await fetchPage(page)
    if (stopped?.()) return { tracks, complete: false }
    const next = appendFavPage(tracks, result.tracks)
    if (result.has_more && next.length === tracks.length && result.tracks.length > 0) {
      return { tracks, complete: false }
    }
    tracks = next
    onProgress?.(tracks, page, !result.has_more)
    if (!result.has_more) return { tracks, complete: true }
    // 接口连续报空页并声称还有数据时，保留已读部分供重试。
    emptyPages = result.tracks.length === 0 ? emptyPages + 1 : 0
    if (emptyPages >= 2) return { tracks, complete: false }
  }
}
