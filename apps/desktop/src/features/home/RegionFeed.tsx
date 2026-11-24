import { useEffect, useState } from 'react'
import type { DiscoveryRegion } from '../../shared/lib/discoveryRegions'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { ContentGrid } from '../tracks/ContentGrid'
import { FeedMoreButton } from './FeedMoreButton'
import { discoveryTabKey } from './discoveryTabs'

type RegionPage = { tracks: Track[]; page: number; hasMore: boolean; top: number; index: number }
export const regionMemory = new Map<string, RegionPage>()

const illustrations: Record<string, string> = {
  动画: 'animation-cels',
  音乐: 'cassette',
  游戏: 'handheld',
}

export function RegionFeed({ tab, activeKey, playing }: {
  tab: DiscoveryRegion
  activeKey: string | null
  playing: boolean
}) {
  const key = discoveryTabKey(tab)
  const [result, setResult] = useState(() => regionMemory.get(key))
  const [requested, setRequested] = useState(result ? 0 : 1)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { rid, name } = tab
  const illustration = illustrations[name]

  useEffect(() => {
    if (!requested) return
    let active = true
    void ipc.discoveryRegionFeed(rid, requested).then((tracks) => {
      if (!active) return
      const previous = regionMemory.get(key)
      const merged = new Map(previous?.tracks.map((track) => [track.key, track]))
      const before = merged.size
      for (const track of tracks) merged.set(track.key, track)
      const next = {
        tracks: [...merged.values()], page: requested, hasMore: merged.size > before,
        top: previous?.top ?? 0, index: previous?.index ?? 0,
      }
      regionMemory.set(key, next)
      setResult(next)
      setRequested(0)
    }).catch((cause) => {
      if (active) setError(toWireError(cause).message)
    })
    return () => { active = false }
  }, [key, rid, requested, attempt])

  return (
    <section data-home-region className="px-4 pt-4 md:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="flex min-w-0 max-w-full items-center gap-2 text-[16px] font-semibold">
          {illustration && <img src={`/assets/illustrations/${illustration}.png`} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />}
          <span className="min-w-0 truncate">{name}</span>
        </h2>
      </div>
      {result && result.tracks.length > 0 && (
        <ContentGrid tracks={result.tracks} activeKey={activeKey} playing={playing} initialIndex={result.index} />
      )}
      {error ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-center text-[12.5px] text-[var(--text-3)]">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setAttempt((n) => n + 1)
            }}
            className="t press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[12.5px]"
          >
            重试
          </button>
        </div>
      ) : requested > 0 ? (
        <BiliLoader compact={!!result} label={result ? '正在加载更多…' : '正在加载视频…'} />
      ) : result?.hasMore ? (
        <FeedMoreButton onMore={() => setRequested(result.page + 1)} />
      ) : result?.tracks.length === 0 ? (
        <p className="py-8 text-center text-[12.5px] text-[var(--text-3)]">
          这个分区暂时没有投稿。
        </p>
      ) : null}
    </section>
  )
}
