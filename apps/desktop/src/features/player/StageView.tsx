import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import type { LyricDoc } from '../../shared/lib/contract'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { DanmakuComposer } from './DanmakuComposer'
import { DanmakuLayer } from './DanmakuLayer'
import { DanmakuPanel } from './DanmakuPanel'
import { LevelBars } from './LevelBars'
import { VideoInfo } from './VideoInfo'
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
  const [related, setRelated] = useState<Track[]>([])
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

  // 相关推荐只在舞台打开时拉，关掉就不再请求。
  useEffect(() => {
    if (!open || !track) {
      setRelated([])
      return
    }
    let cancelled = false
    void ipc
      .related(track.key)
      .then((list) => {
        if (!cancelled) setRelated(list.slice(0, 8))
      })
      .catch(() => setRelated([]))
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
    <div
      className="stage fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'var(--ga0)' }}
    >
      {/* 背景：同一张封面铺满并重度模糊，画面颜色全部来自这张图 */}
      {track.cover ? (
        <img
          src={track.cover}
          alt=""
          aria-hidden
          referrerPolicy="no-referrer"
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-[100px] saturate-125"
        />
      ) : null}
      {/* 浅色底：白色半透明压住封面，让文字在任何封面上都读得清 */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--ga0)' }} />
      <div className="pointer-events-none absolute inset-0 bg-white/55" />
      <div className="bili-canvas pointer-events-none absolute inset-0 opacity-60" />
      <DanmakuLayer trackKey={track.key} position={snapshot?.position_ms ?? 0} />

      <button
        type="button"
        onClick={() => setStage(false)}
        aria-label="退出舞台"
        className="t press absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]"
      >
        <Icon name="close" size={16} />
      </button>

      <DanmakuPanel />

      <div className="relative flex w-full max-w-[560px] flex-col items-center px-8">
        <div className="stage-disc">
          <Cover
            cover={track.cover}
            title={track.title}
            className="h-[148px] w-[148px] rounded-full border-4 border-white shadow-[0_18px_50px_-16px_rgba(0,0,0,0.45)] md:h-[188px] md:w-[188px]"
            glyphClassName="text-[64px] font-semibold text-[var(--text-1)]"
          />
        </div>

        <h2 className="mt-5 max-w-full truncate text-[24px] font-semibold text-[var(--text-1)]" title={track.title}>
          {track.title}
        </h2>
        <p className="mt-1 truncate text-[14px] text-[var(--text-2)]" title={track.artist}>
          {track.artist}
        </p>

        <div className="mt-4 flex min-h-[62px] flex-col items-center text-center">
          <p className="stage-line text-[24px] leading-[1.45] text-[var(--text-1)]">{current || '♪'}</p>
          <p className="mt-3 text-[16px] leading-[1.5] text-[var(--text-3)]">{upcoming}</p>
        </div>

        {/* 弹幕输入框放在播放键上方：真机窗口比网页矮，放下面会被底部的
            「相关推荐」压住，实测看不到。 */}
        <div className="mt-4 flex w-full justify-center px-8">
          <DanmakuComposer trackKey={track.key} position={snapshot?.position_ms ?? 0} />
        </div>

        <div className="mt-4 flex items-center gap-6 text-[var(--text-2)]">
          <button type="button" aria-label="上一首" onClick={() => void prev()} className="t press hover:text-[var(--text-1)]">
            <Icon name="prev" size={22} />
          </button>
          <button
            type="button"
            aria-label={snapshot?.phase === 'playing' ? '暂停' : '播放'}
            onClick={() => void toggle()}
            className="bili-press flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_6px_20px_-6px_rgba(251,114,153,0.8)]"
          >
            <Icon name={snapshot?.phase === 'playing' ? 'pause' : 'play'} size={22} />
          </button>
          <button type="button" aria-label="下一首" onClick={() => void next()} className="t press hover:text-[var(--text-1)]">
            <Icon name="next" size={22} />
          </button>
        </div>

        <div className="mt-3 text-[var(--accent)]">
          <LevelBars />
        </div>

        <VideoInfo trackKey={track.key} />
      </div>

      {related.length > 0 ? (
        <div className="absolute inset-x-0 bottom-0 hidden border-t border-[var(--line)] bg-white/80 px-6 py-3 backdrop-blur md:block">
          <div className="mb-2 text-[12px] uppercase tracking-[0.18em] text-[var(--text-3)]">相关推荐</div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {related.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => void usePlayerStore.getState().play(item.key)}
                title={item.title}
                className="group w-[132px] shrink-0 text-left"
              >
                <span className="relative block overflow-hidden rounded-[4px]" style={{ aspectRatio: '16 / 10' }}>
                  <Cover
                    cover={item.cover}
                    title={item.title}
                    className="h-full w-full"
                    glyphClassName="text-[26px] font-semibold text-white/80"
                  />
                </span>
                <span className="mt-1 line-clamp-1 block text-[12px] text-[var(--text-2)] group-hover:text-[var(--accent)]">
                  {item.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
