import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import type { SourceEntry } from './sources'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '外部资源'
  }
}

/** 站内素材的标题与小封面只取一次；失败就退回 BV 号，不阻塞原句。 */
const briefCache = new Map<string, Track | null>()

function useBrief(bvid: string | undefined): Track | null {
  const [brief, setBrief] = useState<Track | null>(() => (bvid ? (briefCache.get(bvid) ?? null) : null))

  useEffect(() => {
    if (!bvid) return
    if (briefCache.has(bvid)) {
      setBrief(briefCache.get(bvid) ?? null)
      return
    }
    let alive = true
    void ipc
      .videoBrief(bvid)
      .then((track) => {
        briefCache.set(bvid, track)
        if (alive) setBrief(track)
      })
      .catch(() => {
        briefCache.set(bvid, null)
      })
    return () => {
      alive = false
    }
  }, [bvid])

  return brief
}

function SourceRow({ entry, onOpen }: { entry: SourceEntry; onOpen: (entry: SourceEntry) => void }) {
  const brief = useBrief(entry.kind === 'video' ? entry.bvid : undefined)
  const label =
    entry.kind === 'video' ? (brief?.title ?? `站内视频 ${entry.bvid}`) : `外部资源 · ${hostOf(entry.url!)}`

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 gap-2">
        {entry.kind === 'video' && brief?.cover ? (
          <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-[4px] bg-[var(--ga1)]">
            <Cover cover={brief.cover} title={brief.title} width={160} className="h-full w-full" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 rounded-[3px] bg-[color-mix(in_oklab,var(--accent)_10%,white)] px-1.5 text-[11px] leading-[18px] text-[var(--accent)]">
              {entry.relations.join('、')}
            </span>
            <button
              type="button"
              onClick={() => onOpen(entry)}
              data-focus-id={entry.kind === 'video' ? `source:${entry.bvid}` : undefined}
              className="t flex min-w-0 items-center gap-1 text-[12px] text-[var(--text-2)] hover:text-[var(--accent)]"
            >
              <span className="truncate">{label}</span>
              <Icon name={entry.kind === 'video' ? 'play' : 'external'} size={11} className="shrink-0" />
            </button>
            {entry.kind === 'video' && brief?.artist ? (
              <span className="min-w-0 truncate text-[11px] text-[var(--text-3)]">UP {brief.artist}</span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 break-words text-[12px] leading-[18px] text-[var(--text-3)]">
            {entry.sentence}
          </p>
        </div>
      </div>
    </li>
  )
}

/**
 * 简介里的素材与出处。只列作者自己写明关系词的链接，
 * 站内作品先进本产品的观看页，外部资源明确标站点并交给系统浏览器。
 */
export function SourceLinks({ entries }: { entries: SourceEntry[] }) {
  const navigate = useAppStore((state) => state.navigate)
  if (entries.length === 0) return null

  const open = (entry: SourceEntry): void => {
    if (entry.kind === 'video' && entry.bvid) {
      const track: Track = {
        key: entry.bvid,
        title: entry.bvid,
        artist: '',
        duration_ms: null,
        cover: null,
      }
      navigate({ kind: 'watch', track }, undefined, `source:${entry.bvid}`)
      return
    }
    if (entry.url) {
      void ipc.openExternal(entry.url).catch((cause) => toastFailure('打开素材链接', cause))
    }
  }

  return (
    <section data-source-links className="mt-3 max-w-[820px] rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-2)]">
        <Icon name="external" size={12} />
        素材与出处
      </h3>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {entries.map((entry) => (
          <SourceRow key={entry.id} entry={entry} onOpen={open} />
        ))}
      </ul>
    </section>
  )
}
