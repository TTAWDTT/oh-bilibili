import { useEffect, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { formatDuration } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { Cover } from '../../shared/ui/Cover'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { useAppStore } from '../../app/appStore'

function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(n)
}

/**
 * 相关推荐。放在右栏歌词下面，填掉歌词短时的大片空白。
 *
 * B 站的视频页右栏就是「视频信息 + 相关推荐」这个结构，推荐列表能一直往下看。
 * 数据来自 related 接口，是真实的关联视频。
 */
export function RelatedList({ trackKey }: { trackKey: string }) {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  // 相关推荐是「另一条视频」，点它应该打开那条的观看页，而不是接着播声音。
  const navigate = useAppStore((state) => state.navigate)

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    void ipc
      .related(trackKey)
      .then((list) => {
        if (!cancelled) setTracks(list.slice(0, 8))
      })
      .catch(() => {
        if (!cancelled) setTracks([])
      })
    return () => {
      cancelled = true
    }
  }, [trackKey])

  if (tracks === null) return <BiliLoader compact label="正在取相关推荐…" />
  if (tracks.length === 0) return null

  return (
    <div className="border-t border-hairline">
      <div className="px-4 pb-1 pt-3 text-[12px] tracking-[0.14em] text-[var(--text-3)]">相关推荐</div>
      <ul>
        {tracks.map((track) => (
          <li key={track.key}>
            <button
              type="button"
              onClick={() => navigate({ kind: 'watch', track })}
              title={`${track.title} · ${track.artist}`}
              className="group flex w-full items-center gap-2.5 px-4 py-1.5 text-left hover:bg-[var(--hover)]"
            >
              <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-[3px]">
                <Cover cover={track.cover} title={track.title} width={136} className="h-full w-full" />
                <span className="num absolute bottom-0.5 right-0.5 rounded-[2px] bg-black/60 px-1 text-[10px] leading-[13px] text-white">
                  {formatDuration(track.duration_ms)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] leading-[1.35] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                  {track.title}
                </span>
                <span className="num mt-0.5 flex items-center gap-1 text-[11.5px] text-[var(--text-3)]">
                  <span className="truncate">{track.artist}</span>
                  <span>·</span>
                  <span className="shrink-0">{formatCount(track.views ?? 0)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
