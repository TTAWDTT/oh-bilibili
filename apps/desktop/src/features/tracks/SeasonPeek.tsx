import { useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { SeasonView } from '../../shared/lib/contract'
import { useAppStore } from '../../app/appStore'
import { AnchoredPanel } from '../../shared/ui/AnchoredPanel'
import { Cover } from '../../shared/ui/Cover'
import { formatDuration } from '../../shared/lib/format'
import { readSeasonMark } from './seasonMark'

/** 打开过的合集缓存：同一稿点第二次不再发请求。 */
const seasons = new Map<string, SeasonView | null>()

/**
 * 卡片上的「所属合集」。
 *
 * 只在用户点开时发一次详情请求（走引擎已有的详情缓存），
 * 不在滚动或渲染时逐稿请求。没有合集就整块不出现。
 */
export function SeasonPeek({
  trackKey,
  title,
  onOpen,
}: {
  trackKey: string
  title: string | null
  /** 点某一集时当作打开这条视频。 */
  onOpen: (trackKey: string) => void
}) {
  const navigate = useAppStore((state) => state.navigate)
  const [open, setOpen] = useState(false)
  const [season, setSeason] = useState<SeasonView | null | undefined>(() => seasons.get(trackKey))
  const [failed, setFailed] = useState(false)

  const load = (): void => {
    if (seasons.has(trackKey)) {
      setSeason(seasons.get(trackKey) ?? null)
      return
    }
    void ipc
      .seasonOf(trackKey)
      .then((value) => {
        seasons.set(trackKey, value)
        setSeason(value)
      })
      .catch(() => setFailed(true))
  }

  return (
    <>
      <button
        type="button"
        data-season-peek={trackKey}
        onClick={(event) => {
          event.stopPropagation()
          if (season === undefined) load()
          setOpen((current) => !current)
        }}
        className="t press shrink-0 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
      >
        所属合集
      </button>
      <AnchoredPanel
        anchor={
          open
            ? (() => {
                const el = document.querySelector<HTMLElement>(`[data-season-peek="${trackKey}"]`)
                if (!el) return null
                const rect = el.getBoundingClientRect()
                return { left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), top: rect.bottom + 6, anchorTop: rect.top }
              })()
            : null
        }
        onClose={() => setOpen(false)}
        label="所属合集"
        width={320}
      >
        <div className="p-2.5">
          <p className="mb-2 px-1 text-[12.5px] text-[var(--text-2)]">
            {season === undefined ? '正在取合集…' : (season?.title ?? '这一稿没有合集')}
          </p>
          {failed ? (
            <p className="px-1 pb-1 text-[12px] text-[var(--text-3)]">
              合集没取到，
              <button
                type="button"
                onClick={() => {
                  setFailed(false)
                  load()
                }}
                className="t text-[var(--accent)] hover:underline"
              >
                重试
              </button>
            </p>
          ) : null}
          {season ? (
            <ul className="flex max-h-[46vh] flex-col gap-0.5 overflow-y-auto">
              {season.episodes.map((episode) => (
                <li key={episode.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onOpen(episode.key)
                    }}
                    aria-current={episode.current ? 'true' : undefined}
                    className={`t flex w-full items-center gap-2 rounded-[4px] px-1 py-1 text-left hover:bg-[var(--panel-alt)] ${
                      episode.current ? 'text-[var(--accent)]' : 'text-[var(--text-1)]'
                    }`}
                  >
                    <span className="relative h-8 w-14 shrink-0 overflow-hidden rounded-[3px] bg-[var(--ga1)]">
                      <Cover cover={episode.cover} title={episode.title} width={112} className="h-full w-full" />
                    </span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-[17px]">
                      {episode.title}
                    </span>
                    <span className="num shrink-0 text-[11px] text-[var(--text-3)]">
                      {episode.duration_ms > 0 ? formatDuration(episode.duration_ms) : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {season ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate({ kind: 'watch', track: { key: trackKey, title: title ?? trackKey, artist: '', duration_ms: null, cover: null } })
              }}
              className="t mt-2 w-full rounded-[4px] bg-[var(--panel-alt)] py-1 text-[12px] text-[var(--text-2)] hover:text-[var(--accent)]"
            >
              打开这一集
            </button>
          ) : null}
        </div>
      </AnchoredPanel>
    </>
  )
}

/** 卡片是否有合集标记：只有之前打开过、确认属于合集才显示入口。 */
export function hasSeasonMark(trackKey: string | undefined): boolean {
  return readSeasonMark(trackKey) !== null
}
