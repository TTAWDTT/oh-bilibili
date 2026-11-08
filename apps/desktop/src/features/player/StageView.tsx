import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { LyricDoc } from '../../shared/lib/contract'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { LevelBars } from './LevelBars'
import { usePlayerStore } from './playerStore'

/**
 * 整屏舞台。播放时点封面进入，退出后回到列表。
 *
 * 这一屏不做"信息"，只做"在场"：封面铺满、背景是同一张图重模糊、
 * 歌词只留当前一句和下一句。列表页负责找歌，这里负责听歌。
 */
export function StageView() {
  const open = useAppStore((state) => state.stage)
  const setStage = useAppStore((state) => state.setStage)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const toggle = usePlayerStore((state) => state.toggle)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const [doc, setDoc] = useState<LyricDoc | null>(null)
  const track = snapshot?.track ?? null

  useEffect(() => {
    if (!open || !track) return
    let cancelled = false
    void ipc
      .lyricsGet(track.key)
      .then((d) => {
        if (!cancelled) setDoc(d)
      })
      .catch(() => setDoc(null))
    return () => {
      cancelled = true
    }
  }, [open, track])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStage(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setStage])

  if (!open || !track) return null

  const lines = doc?.lines ?? []
  const pos = snapshot?.position_ms ?? 0
  let active = -1
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i]?.at_ms ?? 0) <= pos) active = i
  }
  const current = lines[active]?.text ?? ''
  const upcoming = lines[active + 1]?.text ?? ''

  return (
    <div className="stage fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden">
      {/* 背景：同一张封面铺满并重度模糊，画面颜色全部来自这张图 */}
      {track.cover ? (
        <img
          src={track.cover}
          alt=""
          aria-hidden
          referrerPolicy="no-referrer"
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-[90px] saturate-150"
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-black/45" />

      <button
        type="button"
        onClick={() => setStage(false)}
        aria-label="退出舞台"
        className="t press absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]"
      >
        <Icon name="close" size={16} />
      </button>

      <div className="relative flex w-full max-w-[560px] flex-col items-center px-8">
        <div className="stage-disc">
          <Cover
            cover={track.cover}
            title={track.title}
            className="h-[240px] w-[240px] rounded-full border border-white/20"
            glyphClassName="text-[64px] font-semibold text-[var(--text-1)]"
          />
        </div>

        <h2 className="mt-8 max-w-full truncate text-[26px] font-semibold text-[var(--text-1)]" title={track.title}>
          {track.title}
        </h2>
        <p className="mt-1 truncate text-[13px] text-[var(--text-2)]" title={track.artist}>
          {track.artist}
        </p>

        <div className="mt-10 flex min-h-[92px] flex-col items-center text-center">
          <p className="stage-line text-[27px] leading-[1.45] text-[var(--text-1)]">{current || '♪'}</p>
          <p className="mt-3 text-[14px] leading-[1.5] text-[var(--text-3)]">{upcoming}</p>
        </div>

        <div className="mt-8 flex items-center gap-6 text-[var(--text-2)]">
          <button type="button" aria-label="上一首" onClick={() => void prev()} className="t press hover:text-[var(--text-1)]">
            <Icon name="prev" size={22} />
          </button>
          <button
            type="button"
            aria-label={snapshot?.phase === 'playing' ? '暂停' : '播放'}
            onClick={() => void toggle()}
            className="t press flex h-14 w-14 items-center justify-center rounded-full bg-white text-black"
          >
            <Icon name={snapshot?.phase === 'playing' ? 'pause' : 'play'} size={22} />
          </button>
          <button type="button" aria-label="下一首" onClick={() => void next()} className="t press hover:text-[var(--text-1)]">
            <Icon name="next" size={22} />
          </button>
        </div>

        <div className="mt-6 text-[var(--accent)]">
          <LevelBars />
        </div>
      </div>
    </div>
  )
}
