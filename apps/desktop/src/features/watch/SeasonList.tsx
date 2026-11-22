import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { SeasonView } from '../../shared/lib/contract'
import { formatCount, formatTime } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { scrollIntoList } from './listScroll'

/**
 * 右栏的合集。
 *
 * B 站观看页把合集放在相关推荐上面：标题带集数，每集一行可点。
 * 这里点一集直接换过去，返回时仍然回到进来的那一页（用 replace 不压栈）。
 */
export function SeasonList({ season, bare = false }: { season: SeasonView; bare?: boolean }) {
  const replace = useAppStore((s) => s.replace)
  const currentRef = useRef<HTMLLIElement | null>(null)
  const listRef = useRef<HTMLOListElement | null>(null)
  const currentKey = season.episodes.find((ep) => ep.current)?.key ?? null
  const currentIndex = season.episodes.findIndex((ep) => ep.current)
  const [seen, setSeen] = useState<Record<string, number>>({})

  useEffect(() => {
    scrollIntoList(currentRef.current, listRef.current)
  }, [currentKey])

  useEffect(() => {
    const keys = season.episodes.map((episode) => episode.key)
    if (keys.length === 0) return
    let alive = true
    void ipc
      .historyPositions(keys)
      .then((rows) => {
        if (alive) setSeen(Object.fromEntries(rows))
      })
      .catch(() => {
        // 读不到历史就不画进度，目录本身照常能用
      })
    return () => {
      alive = false
    }
  }, [season])

  return (
    <div className={bare ? '' : 'px-2 pb-2'}>
      <div className={bare ? '' : 'overflow-hidden rounded-[8px] border border-[var(--line)]'}>
        <div className="flex items-baseline gap-2 border-b border-hairline px-3 py-2">
          <h3 className="min-w-0 truncate text-[13px] font-medium text-[var(--text-1)]" title={season.title}>
            {season.title}
          </h3>
          <span className="num shrink-0 text-[11px] text-[var(--text-3)]">
            {currentIndex >= 0 ? `${currentIndex + 1}/` : ''}
            {season.episodes.length}
          </span>
        </div>
        <ol ref={listRef} className="flex max-h-[320px] flex-col gap-y-1.5 overflow-y-auto px-2 py-2">
          {season.episodes.map((ep, index) => {
            const resume = resumeLabel(ep, seen[ep.key])
            return (
              <li key={ep.key} ref={ep.current ? currentRef : undefined}>
                <button
                  type="button"
                  disabled={ep.current}
                  onClick={() =>
                    replace({
                      kind: 'watch',
                      track: {
                        key: ep.key,
                        title: ep.title,
                        artist: '',
                        duration_ms: ep.duration_ms || null,
                        cover: ep.cover,
                        views: ep.views,
                      },
                    })
                  }
                  title={ep.title}
                  className={`group flex w-full items-start gap-2 rounded-[4px] px-1 py-1 text-left ${
                    ep.current ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--panel-alt)]'
                  }`}
                >
                  <span className="num w-4 shrink-0 pt-0.5 text-right text-[11px] text-[var(--text-3)]">
                    {index + 1}
                  </span>
                  <span
                    className="relative w-[88px] shrink-0 overflow-hidden rounded-[3px]"
                    style={{ aspectRatio: '16 / 10' }}
                  >
                    <Cover cover={ep.cover} title={ep.title} width={88} className="h-full w-full" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`line-clamp-2 text-[12px] leading-[1.35] ${
                        ep.current ? 'text-[var(--accent)]' : 'text-[var(--text-1)] group-hover:text-[var(--accent)]'
                      }`}
                    >
                      {ep.title}
                    </span>
                    <span className="num mt-0.5 block truncate text-[11px] text-[var(--text-3)]">
                      {ep.duration_ms ? formatTime(ep.duration_ms) : ''}
                      {ep.views ? ` · ${formatCount(ep.views)}` : ''}
                      {resume ? ` · ${resume}` : ''}
                    </span>
                  </span>
                  {ep.current ? (
                    <Icon name="play" size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/** 只有落在尾部 1 秒内才算看完；当前集由播放器自己显示实时进度。 */
function resumeLabel(
  episode: SeasonView['episodes'][number],
  seen: number | undefined,
): string | null {
  if (episode.current || !seen || seen <= 0) return null
  if (episode.duration_ms > 0 && seen >= episode.duration_ms - 1_000) return '已看完'
  return `播至 ${formatTime(seen)}`
}
