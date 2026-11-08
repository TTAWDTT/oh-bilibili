import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { Skeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'

function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(n)
}

/** 前三名的名次色。B 站排行榜也是金银铜三色。 */
const MEDAL = ['#fb7299', '#ffa63c', '#00aeec']

/**
 * 热门排行榜。B 站首页右侧有排行榜，这是它信息密度最高的模块之一。
 *
 * 数据是真的：按播放量排序搜一次，取前 10。不是写死的假榜。
 */
export function HotRanking({ onPick, limit = 10 }: { onPick: (keyword: string) => void; limit?: number }) {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const play = usePlayerStore((state) => state.playContext)

  useEffect(() => {
    let cancelled = false
    void ipc
      .searchQ('音乐', 1, 'click')
      .then(async (list) => {
        // 关键词命中不到时退一步拿全量，预览模式也能有榜单可看。
        // 真实接口下「音乐」不会为空，这条分支只在 mock 里走。
        const next = list.length >= 3 ? list : await ipc.searchQ('', 1, 'click').catch(() => list)
        if (!cancelled) setTracks(next.slice(0, limit))
      })
      .catch(() => {
        if (!cancelled) setTracks([])
      })
    return () => {
      cancelled = true
    }
  }, [limit])

  if (tracks === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  // 少于 3 条分栏会失衡，不如不显示。
  if (tracks.length < 3) return null

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-[0.22em] text-[var(--text-2)]">热门排行</span>
        <button
          type="button"
          onClick={() => onPick('音乐')}
          className="text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          更多 ›
        </button>
      </div>
      <ol className="mt-2.5 space-y-1">
        {tracks.map((track, i) => (
          <li key={track.key}>
            <button
              type="button"
              onClick={() => void play(tracks.map((t) => t.key), i)}
              title={`${track.title} · ${track.artist}`}
              className="bili-nav-item group flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left hover:bg-[var(--panel-raised)]"
            >
              <span
                className="num w-4 shrink-0 text-center font-mono text-[14px] font-semibold"
                style={{ color: MEDAL[i] ?? 'var(--text-3)' }}
              >
                {i + 1}
              </span>
              <span className="relative h-8 w-[52px] shrink-0 overflow-hidden rounded-[3px]">
                <Cover cover={track.cover} title={track.title} className="h-full w-full" glyphClassName="text-[14px] text-white/85" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                  {track.title}
                </span>
                <span className="num block truncate text-[12px] text-[var(--text-3)]">
                  <Icon name="play" size={9} className="mr-0.5 inline" />
                  {formatCount(track.views ?? 0)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
