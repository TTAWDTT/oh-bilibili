import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { PART_CHILDREN, PARTS } from '../../shared/lib/biliParts'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { ContentGrid } from '../tracks/ContentGrid'

export const regionMemory = new Map<number, { tracks: Track[]; top: number }>()

export function RegionFeed({ rid, illustration, activeKey, playing }: { rid: number; illustration: string | undefined; activeKey: string | null; playing: boolean }) {
  const navigate = useAppStore((state) => state.navigate)
  const [tracks, setTracks] = useState<Track[] | null>(() => regionMemory.get(rid)?.tracks ?? null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const childTrigger = useRef<HTMLButtonElement>(null)
  const name = PARTS.find((part) => part.rid === rid)!.name

  useEffect(() => {
    if (regionMemory.has(rid)) return
    let active = true
    void ipc.regionNew(rid, 1)
      .then((list) => {
        if (!active) return
        regionMemory.set(rid, { tracks: list, top: 0 })
        setTracks(list)
      })
      .catch((cause) => {
        if (active) setError(toWireError(cause).message)
      })
    return () => { active = false }
  }, [rid, attempt])

  return (
    <section data-home-region className="px-4 pt-4 md:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="discovery-heading flex items-center gap-2">
          {illustration && <img src={`/assets/illustrations/${illustration}.png`} alt="" width={28} height={28} className="h-7 w-7 object-contain" />}
          {name}<span className="self-end pb-0.5 text-[13px] font-normal text-[var(--text-2)]">最新投稿</span>
        </h2>
        <div className="ml-auto flex items-center gap-3 text-[12.5px] text-[var(--text-2)]">
          <button
            type="button"
            ref={childTrigger}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 py-1 hover:text-[var(--accent-strong)]"
          >
            子分区<Icon name="chevronRight" size={12} className={expanded ? '-rotate-90' : 'rotate-90'} />
          </button>
          <button
            type="button"
            data-focus-id={`region-rank:${rid}`}
            onClick={() => navigate({ kind: 'ranking', rid }, undefined, `region-rank:${rid}`)}
            className="flex items-center gap-1 py-1 hover:text-[var(--accent-strong)]"
          >
            {name}排行榜<Icon name="chevronRight" size={12} />
          </button>
        </div>
      </div>
      {expanded ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-[var(--line)] py-2 text-[12.5px]"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            setExpanded(false)
            childTrigger.current?.focus()
          }}
        >
          <span className="text-[var(--text-3)]">在{name}区搜索</span>
          {PART_CHILDREN[name]?.map((child) => (
            <button
              key={child}
              type="button"
              className="py-1 hover:text-[var(--accent-strong)]"
              onClick={() => {
                useAppStore.getState().setSearchFilters({ currentPartition: name, currentOrder: 'totalrank', currentDuration: 0 })
                useAppStore.getState().setHeroQuery(child)
              }}
            >
              {child}
            </button>
          ))}
        </div>
      ) : null}
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
      ) : tracks === null ? <BiliLoader label="正在取这个分区…" /> : tracks.length > 0 ? (
        <ContentGrid tracks={tracks} activeKey={activeKey} playing={playing} />
      ) : <p className="py-8 text-center text-[12.5px] text-[var(--text-3)]">这个分区暂时没有内容。</p>}
    </section>
  )
}
