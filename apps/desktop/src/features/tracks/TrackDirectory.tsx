import { useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { formatDuration } from '../../shared/lib/format'
import { AnchoredPanel, type Anchor } from '../../shared/ui/AnchoredPanel'
import { Cover } from '../../shared/ui/Cover'
import { useAppStore } from '../../app/appStore'
import { knownPageCount, readResumePage, spineLabel } from './pageSpineLabel'
import { readSeasonMark, seasonLabel } from './seasonMark'

type DirectoryItem = { track: Track; page?: number; current: boolean }
type Directory = { title: string; items: DirectoryItem[] }

export function TrackDirectory({ track }: { track: Track }) {
  const count = knownPageCount(track.key, track.pages)
  const resume = count && count > 1 ? readResumePage(track.key) : null
  const parts = spineLabel(count, resume)
  const continued = resume !== null && count !== null && resume <= count
  const season = readSeasonMark(track.key)
  if (!parts && !season) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {parts && (
        <DirectoryButton track={track} kind="parts" label={parts}
          name={`查看分 P，本稿 ${count} 个分 P${continued ? `，上次看到 P${resume}` : ''}`} />
      )}
      {season && (
        <DirectoryButton track={track} kind="season" label={parts ? '所属合集' : seasonLabel(season) ?? '合集'}
          name={`查看合集，${season.title}`} />
      )}
    </div>
  )
}

function DirectoryButton({ track, kind, label, name }: {
  track: Track
  kind: 'parts' | 'season'
  label: string
  name: string
}) {
  const navigate = useAppStore((state) => state.navigate)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [failed, setFailed] = useState(false)
  const focusId = `directory:${kind}:${track.key}`
  const load = async (): Promise<void> => {
    setFailed(false)
    try {
      setDirectory(await readDirectory(track, kind))
    } catch {
      setFailed(true)
    }
  }
  return (
    <>
      <button
        type="button"
        data-focus-id={focusId}
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          if (anchor) { setAnchor(null); return }
          const trigger = event.currentTarget
          const rect = trigger.getBoundingClientRect()
          setAnchor({ trigger, left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), top: rect.bottom + 4, anchorTop: rect.top })
          if (!directory) void load()
        }}
        className={`num rounded-sm border-[var(--text-3)] pl-1.5 pr-1 text-[12px] leading-5 text-[var(--text-2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] ${kind === 'season' ? 'border-l-4 border-double' : 'border-l-2'}`}
      >
        {label}
      </button>
      <AnchoredPanel anchor={anchor} onClose={() => setAnchor(null)} label={name} width={320}>
        <div className="p-2">
          {failed ? (
            <button type="button" className="p-2 text-[13px] text-[var(--accent-strong)]" onClick={() => void load()}>目录没取到，重试</button>
          ) : directory ? (
            <>
              <p className="truncate px-2 pb-1 text-[13px] font-medium">{directory.title}</p>
              {directory.items.length === 0 ? <p className="px-2 text-[13px]">暂无目录</p> : (
                <ul className="max-h-[45vh] overflow-y-auto">
                  {directory.items.map((item) => (
                    <li key={item.page ?? item.track.key}>
                      <button type="button" aria-current={item.current || undefined}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-[var(--panel-alt)] aria-[current=true]:text-[var(--accent-strong)]"
                        onClick={() => {
                          setAnchor(null)
                          navigate({ kind: 'watch', track: item.page ? track : item.track, ...(item.page ? { page: item.page } : {}) }, undefined, focusId)
                        }}>
                        {item.page ? <span className="num shrink-0">P{item.page}</span> : (
                          <span className="block h-8 w-14 shrink-0 overflow-hidden rounded">
                            <Cover cover={item.track.cover} title={item.track.title} width={112} className="h-full w-full" />
                          </span>
                        )}
                        <span className="line-clamp-2 flex-1">{item.track.title}</span>
                        {item.track.duration_ms ? <span className="num text-[12px]">{formatDuration(item.track.duration_ms)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : <p role="status" className="px-2 text-[13px]">正在读取目录…</p>}
        </div>
      </AnchoredPanel>
    </>
  )
}

async function readDirectory(track: Track, kind: 'parts' | 'season'): Promise<Directory> {
  if (kind === 'parts') {
    const { pages } = await ipc.videoMeta(track.key)
    const resume = readResumePage(track.key)
    return {
      title: track.title,
      items: pages.map((page) => ({
        track: { ...track, title: page.title, duration_ms: page.duration_ms },
        page: page.no, current: page.no === resume,
      })),
    }
  }
  const season = await ipc.seasonOf(track.key)
  return {
    title: season?.title ?? '所属合集',
    items: (season?.episodes ?? []).map((episode) => ({
      track: { key: episode.key, title: episode.title, cover: episode.cover, duration_ms: episode.duration_ms, artist: '' },
      current: episode.current,
    })),
  }
}
