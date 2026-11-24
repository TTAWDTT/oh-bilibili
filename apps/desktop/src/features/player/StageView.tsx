import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import { useSmoothIndex } from '../../shared/lib/useSmoothIndex'
import { readPlayhead } from '../../shared/lib/playhead'
import { useSwipe } from '../../shared/lib/useSwipe'
import type { Track } from '../../shared/lib/contract'
import type { LyricDoc } from '../../shared/lib/contract'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { DanmakuComposer } from './DanmakuComposer'
import { DanmakuLayer, useStageDanmaku } from './DanmakuLayer'
import { DanmakuPanel } from './DanmakuPanel'
import { LevelBars } from './LevelBars'
import { VideoInfo } from './VideoInfo'
import { PlaybackProgress } from './PlaybackProgress'
import { playbackSubtitle, usePlayerStore } from './playerStore'
import { thumbWide } from '../../shared/lib/thumb'
import { StageLyrics } from './StageLyrics'
import { useStageCoverMorph } from './stageCoverMorph'
import { VolumeControl } from './VolumeControl'

/**
 * 整屏舞台。播放时点封面进入，退出后回到列表。
 *
 * 这一屏不做"信息"，只做"在场"：封面铺满、背景是同一张图重模糊、
 * 歌词只留当前一句和下一句。列表页负责找歌，这里负责听歌。
 */
const EMPTY_TIMES: number[] = []

export function StageView() {
  const open = useAppStore((state) => state.stage)
  const navigate = useAppStore((state) => state.navigate)
  const setStage = useAppStore((state) => state.setStage)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const toggle = usePlayerStore((state) => state.toggle)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const shuffle = usePlayerStore((state) => state.snapshot?.shuffle ?? false)
  const repeat = usePlayerStore((state) => state.snapshot?.repeat ?? 'off')
  const setShuffle = usePlayerStore((state) => state.setShuffle)
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat)
  const [doc, setDoc] = useState<LyricDoc | null>(null)
  const [related, setRelated] = useState<Track[]>([])
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [lyricsFailed, setLyricsFailed] = useState<string | null>(null)
  const [lyricsAttempt, setLyricsAttempt] = useState(0)
  const [relatedOpen, setRelatedOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const vinylRef = useRef<HTMLDivElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const track = snapshot?.track ?? null
  const cid = snapshot?.page?.cid
  const trackKey = track?.key
  const local = snapshot?.local ?? false
  const danmaku = useStageDanmaku(open && !local ? trackKey : undefined, snapshot?.page ?? null)
  const exitStage = useCallback(() => setStage(false), [setStage])
  const { requestClose, closeNow } = useStageCoverMorph({
    open,
    track,
    stageRef,
    vinylRef,
    onExit: exitStage,
  })

  useEffect(() => {
    if (!open || !trackKey) return
    let cancelled = false
    setDoc(null)
    setLyricsLoading(true)
    setLyricsFailed(null)
    void ipc
      .lyricsGet(trackKey)
      .then((d) => {
        if (!cancelled) {
          setDoc(d)
          setLyricsLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDoc(null)
          setLyricsLoading(false)
          setLyricsFailed('歌词读取失败')
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, trackKey, cid, lyricsAttempt])

  // 相关推荐只在舞台打开时拉，关掉就不再请求。
  useEffect(() => {
    if (!open || !track || local) {
      setRelated([])
      return
    }
    let cancelled = false
    void ipc
      .related(track.key)
      .then((list) => {
        if (!cancelled) setRelated(list.slice(0, 8))
      })
      .catch(() => {
        if (!cancelled) setRelated([])
      })
    return () => {
      cancelled = true
    }
  }, [open, track, local])

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => {
      stageRef.current?.querySelector<HTMLButtonElement>('button[aria-label="退出舞台"]')?.focus()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      const fallback = document.querySelector<HTMLButtonElement>('button[aria-label="打开播放舞台"]')
      const restore = [previousFocus.current, fallback].find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element !== document.body &&
          element.isConnected &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden',
      )
      ;(restore ?? document.getElementById('main-content'))?.focus()
    }
  }, [open, requestClose])

  useEffect(() => {
    if (!open) setRelatedOpen(false)
  }, [open])

  // 必须在提前 return 之前调用：放在之后会让两次渲染的 hook 数量不一致，
  // React 会直接抛「Rendered more hooks than during the previous render」。
  const swipe = useSwipe({
    onLeft: () => void next(),
    onRight: () => void prev(),
  })

  const lineTimes = doc && doc.synced ? doc.lines.map((l) => l.at_ms) : EMPTY_TIMES
  const activeLine = useSmoothIndex(lineTimes, Boolean(doc && doc.synced))

  if (!open || !track) return null

  const subtitle = playbackSubtitle(track, snapshot?.page)
  const lines = doc?.lines ?? []
  // 用平滑索引：只在「换行」时重渲染，而不是每秒 5 次
  const active = activeLine

  return (
    <div
      ref={stageRef}
      {...swipe}
      role="region"
      aria-label="听歌舞台"
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || !stageRef.current) return
        const focusable = [
          ...stageRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.getClientRects().length > 0)
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first || !last) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
      className="stage fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'var(--ga0)' }}
    >
      {/* 背景：同一张封面铺满并重度模糊，画面颜色全部来自这张图 */}
      {track.cover ? (
        <img
          src={thumbWide(track.cover, 640) ?? track.cover}
          alt=""
          aria-hidden
          referrerPolicy="no-referrer"
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-[80px] saturate-150"
        />
      ) : null}
      {/* 白纱必须渐变：整层纯色会把模糊封面完全盖掉，舞台就退化成一张白纸 */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.52),rgba(255,255,255,0.78)_58%,rgba(255,255,255,0.94))]" />
      <div className="absolute left-24 right-4 top-2 z-20 flex h-8 items-center gap-3">
        <button
          type="button"
          onClick={requestClose}
          aria-label="退出舞台"
          className="t press flex h-8 shrink-0 items-center gap-1 rounded-full bg-[var(--panel)]/85 pl-2 pr-3.5 text-[13px] text-[var(--text-2)] shadow-[0_2px_10px_rgba(0,0,0,0.08)] backdrop-blur hover:text-[var(--text-1)]"
        >
          <Icon name="chevronLeft" size={16} />
          退出
        </button>
        {!local && (
          <>
            <div className="relative min-w-0 flex-1 overflow-hidden self-stretch">
              <DanmakuLayer items={danmaku} />
            </div>
            <DanmakuPanel />
          </>
        )}
      </div>

      <div className="stage-content relative z-10 flex min-h-0 w-full max-w-[1180px] flex-1 flex-col px-4 pb-4 pt-16 md:px-8">
        <div className="grid min-h-0 flex-1 content-start items-start gap-5 lg:content-center lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-10">
          <div className="flex min-h-0 flex-col items-center justify-center">
            <div className="stage-disc" data-playing={snapshot?.phase === 'playing'}>
              <div
                ref={vinylRef}
                data-stage-cover={track.key}
                className="stage-vinyl flex h-[116px] w-[116px] items-center justify-center rounded-full sm:h-[168px] sm:w-[168px] lg:h-[236px] lg:w-[236px]"
              >
                <Cover
                  cover={track.cover}
                  title={track.title}
                  className="h-[38%] w-[38%] rounded-full border border-white/20 shadow-[0_2px_12px_rgba(0,0,0,0.5)] ui-audit-ok"
                />
                <span aria-hidden className="stage-spindle" />
              </div>
              <span aria-hidden className="stage-tonearm" data-playing={snapshot?.phase === 'playing'} />
            </div>

            <h2
              className="mt-4 line-clamp-2 max-w-full text-center text-[19px] font-semibold leading-[1.35] text-[var(--text-1)] lg:text-[23px]"
              title={track.title}
            >
              {track.title}
            </h2>
            <p className="mt-1 max-w-full truncate text-[14px] text-[var(--text-2)]" title={subtitle}>
              {subtitle}
            </p>

            {local ? null : (
              <>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      closeNow()
                      navigate({
                        kind: 'watch',
                        track,
                        page: snapshot?.page?.no ?? 1,
                        atMs: Math.round(readPlayhead()),
                        audioPaused: snapshot?.phase === 'paused',
                      }, undefined, 'player-stage')
                    }}
                    className="t press inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel)]/85 px-3 text-[13px] text-[var(--text-1)] hover:text-[var(--accent-strong)]"
                  >
                    <Icon name="play" size={15} />
                    看视频
                  </button>
                  {related.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setRelatedOpen((current) => !current)}
                      aria-expanded={relatedOpen}
                      className="t press h-8 rounded-full border border-[var(--line)] bg-[var(--panel)]/70 px-3 text-[13px] text-[var(--text-2)] hover:text-[var(--accent-strong)]"
                    >
                      相关推荐
                    </button>
                  )}
                </div>
                <div className="stage-extra mt-3 hidden w-full max-w-[360px] justify-center lg:flex">
                  <DanmakuComposer trackKey={track.key} page={snapshot?.page ?? null} />
                </div>
                <div className="stage-extra hidden w-full lg:block">
                  <VideoInfo trackKey={track.key} />
                </div>
              </>
            )}
          </div>

          <div className="stage-lyrics-pane h-[min(30vh,320px)] min-h-[170px] w-full lg:h-[min(58vh,520px)]">
            <div className={relatedOpen ? 'hidden h-full' : 'h-full'}>
              <StageLyrics
                lines={lines}
                danmaku={danmaku}
                synced={Boolean(doc?.synced)}
                active={active}
                loading={lyricsLoading}
                failed={lyricsFailed}
                source={doc?.source ?? ''}
                trackKey={`${track.key}:${cid ?? 0}`}
                onSeek={(at) => void usePlayerStore.getState().seek(at)}
                onRetry={() => setLyricsAttempt((current) => current + 1)}
              />
            </div>
            {relatedOpen ? (
              <div data-stage-related className="flex h-full min-h-0 flex-col">
                <div className="mb-2 flex h-8 shrink-0 items-center px-2 text-[12px] text-[var(--text-3)]">相关推荐</div>
                <div className="no-scrollbar flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
                  {related.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      data-focus-id={`stage:${item.key}`}
                      onClick={() => {
                        closeNow()
                        navigate({ kind: 'watch', track: item }, undefined, `stage:${item.key}`)
                      }}
                      title={item.title}
                      className="group w-[128px] shrink-0 self-start text-left"
                    >
                      <span className="relative block overflow-hidden rounded-[4px]" style={{ aspectRatio: '16 / 10' }}>
                        <Cover cover={item.cover} title={item.title} className="h-full w-full" />
                      </span>
                      <span className="mt-1 line-clamp-2 text-[12px] leading-4 text-[var(--text-2)] group-hover:text-[var(--accent-strong)]">
                        {item.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex shrink-0 items-center justify-center gap-4 text-[var(--text-2)] sm:gap-6">
          <button
            type="button"
            aria-label={shuffle ? '关闭随机播放' : '随机播放'}
            aria-pressed={shuffle}
            onClick={() => setShuffle(!shuffle)}
            className={['t press hover:text-[var(--text-1)]', shuffle ? 'text-[var(--accent)]' : ''].join(' ')}
          >
            <Icon name="shuffle" size={18} />
          </button>
          <button type="button" aria-label="上一首" onClick={() => void prev()} className="t press hover:text-[var(--text-1)]">
            <Icon name="prev" size={22} />
          </button>
          <button
            type="button"
            aria-label={snapshot?.phase === 'playing' ? '暂停' : '播放'}
            onClick={() => void toggle()}
            // 阴影跟随强调色（蓝）。原来这条还留着旧主色的粉色，蓝按钮配粉影子。
            className="bili-press flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_6px_20px_-6px_color-mix(in_oklab,var(--accent)_80%,transparent)]"
          >
            <Icon name={snapshot?.phase === 'playing' ? 'pause' : 'play'} size={22} />
          </button>
          <button type="button" aria-label="下一首" onClick={() => void next()} className="t press hover:text-[var(--text-1)]">
            <Icon name="next" size={22} />
          </button>
          <button
            type="button"
            aria-label={repeat === 'off' ? '循环：关' : repeat === 'all' ? '循环：列表' : '循环：单曲'}
            aria-pressed={repeat !== 'off'}
            onClick={() => void cycleRepeat()}
            className={['t press hover:text-[var(--text-1)]', repeat !== 'off' ? 'text-[var(--accent)]' : ''].join(' ')}
          >
            <Icon name={repeat === 'one' ? 'repeatOne' : 'repeat'} size={18} />
          </button>
          <span className="ml-1 sm:ml-3">
            <VolumeControl compact />
          </span>
        </div>

        <div className="mx-auto mt-2 w-full max-w-[640px] px-2">
          <PlaybackProgress />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 right-5 hidden text-[var(--accent)] lg:block">
        <LevelBars />
      </div>
    </div>
  )
}
