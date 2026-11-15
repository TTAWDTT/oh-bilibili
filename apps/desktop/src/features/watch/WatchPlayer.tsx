import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { QualityOption, Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { DanmakuField } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { DanmakuBeats } from '../player/DanmakuBeats'
import { useDanmakuSettings } from '../player/danmakuSettings'
import { useAuthStore } from '../auth/authStore'
import { useAutoplay } from './autoplay'
import { usePlayerStore } from '../player/playerStore'
import { VolumeControl } from '../player/VolumeControl'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'
import type { ShakaGlobal, ShakaPlayer } from './shaka'

/** 观看页的倍速档位，和 B 站播放器一致。 */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const
/**
 * 音画偏差的三段处理。
 *
 * 硬 seek 会让 MSE 丢掉已缓冲的分片、立刻重新拉流，观感就是「一顿」。
 * 所以只有偏差大到看得出来（>1.2 秒）才 seek；几百毫秒的偏差靠轻微改变
 * 画面播放速度慢慢追，观众察觉不到，缓冲区也不会被打断。
 */
const DRIFT_SEEK_MS = 1200
const DRIFT_NUDGE_MS = 250
/**
 * 画面落后声音多少才值得 seek。
 *
 * 画面跑快时**不能** seek：那会把已经缓冲好的分片全丢掉，再重新拉一遍，
 * 观感就是一顿。让它原地等一下声音就行。只有画面落后太多（跳转、解码卡顿）
 * 才值得往前追。
 */
const DRIFT_LAG_SEEK_MS = 2500
/** 追偏差时最多把画面速度改这么多，再多就看得出来变速了。 */
const NUDGE_RATIO = 0.06

/** 发弹幕可选的颜色，取 B 站播放器那排常用色。 */
const DANMAKU_COLORS: { name: string; value: number }[] = [
  { name: '白', value: 0xffffff },
  { name: '红', value: 0xfe0302 },
  { name: '橙', value: 0xff9104 },
  { name: '黄', value: 0xffd302 },
  { name: '绿', value: 0x00cd00 },
  { name: '蓝', value: 0x00a1d6 },
  { name: '紫', value: 0xa020f0 },
  { name: '黑', value: 0x000000 },
]

/** 弹幕位置：B 站的 mode 参数。 */
const DANMAKU_MODES: { name: string; value: number }[] = [
  { name: '滚动', value: 1 },
  { name: '顶部', value: 5 },
  { name: '底部', value: 4 },
]

const cssColor = (value: number): string => `#${value.toString(16).padStart(6, '0')}`

/**
 * 把 shaka 的错误对象翻成一句人话。
 *
 * 直接 `String(e)` 会把整个对象、内部地址与压缩后的堆栈糊在画面上，
 * 用户看到的是 `shaka.util.Error { "severity": 2, ... }`。这既看不懂，
 * 也不该出现在产品里。
 */
function describePlaybackError(e: unknown): string {
  const detail = e as { data?: unknown[]; code?: number } | null
  const status = typeof detail?.data?.[2] === 'number' ? (detail.data[2] as number) : null
  if (status === 403) return '这一档画面的地址被拒了，换一档画质或稍后再试。'
  if (status === 404) return '这段画面取不到了，稍后再试。'
  if (detail?.code === 1001 || detail?.code === 1002) return '连不上 B 站的视频服务器，检查一下网络。'
  if (detail?.code === 1006) return '这条视频的编码本机不支持。'
  return '这条视频没播起来，换一条或稍后再试。'
}

/**
 * 观看页的播放器：画面、弹幕层、悬浮控制条。
 *
 * 声音只有一个发声者，就是音频引擎。视频元素始终静音，只负责画面，
 * 并且跟着引擎的时钟走：暂停、拖动、换速都以引擎为准。
 * 清单与分片都走本机代理，前端拿不到任何远端地址。
 */
export function WatchPlayer({
  track,
  data,
  danmaku,
  onDanmakuSent,
  onLike,
  onFav,
  onCoin,
  onReplay,
  next,
  onNext,
  resumeAt,
  liked,
  faved,
  coins,
}: {
  track: Track
  data: WatchData
  danmaku: DanmakuItem[]
  onDanmakuSent: (item: DanmakuItem) => void
  /** 播完之后的收尾。B 站也是在这时候把三连与重播摆到画面上。 */
  onLike: () => void
  onFav: () => void
  /** 已投出去的币数，0/1/2。三连里投币要按真实状态置灰。 */
  onCoin: () => void
  onReplay: () => void
  /** 相关推荐里的下一个，播完给个出口。 */
  next: Track | null
  onNext: (track: Track) => void
  /** 上次看到的位置，毫秒。太靠前或太靠后播放器会自己放弃。 */
  resumeAt: number | null
  liked: boolean
  faved: boolean
  coins: number
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<ShakaPlayer | null>(null)
  const hideTimer = useRef<number | null>(null)
  const fullscreenSynced = useRef(false)
  /** 当前生效的变体高度，降档时用它找下一档。 */
  const currentHeight = useRef<number>(0)
  /** 出错后想降到的目标高度；为 0 表示按 shaka 的默认选择。 */
  const wantHeight = useRef<number>(0)
  const [retry, setRetry] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [controls, setControls] = useState(true)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [now, setNow] = useState(0)
  const [draft, setDraft] = useState('')
  /** 发弹幕时用的颜色与位置，和 B 站播放器那排按钮一致。 */
  const [draftColor, setDraftColor] = useState(0xffffff)
  const [draftMode, setDraftMode] = useState(1)
  const [draftPicker, setDraftPicker] = useState(false)
  const [sending, setSending] = useState(false)
  const cinema = useAppStore((state) => state.cinema)
  const setCinema = useAppStore((state) => state.setCinema)
  const osFullscreen = useAppStore((state) => state.osFullscreen)
  const setOsFullscreen = useAppStore((state) => state.setOsFullscreen)
  const [playing, setPlaying] = useState(false)
  /** 播到结尾就掀开三连面板。 */
  const [finished, setFinished] = useState(false)
  /** 「已为你定位」提示里显示的位置；null 表示这条不该续播或用户已经撤销。 */
  const [resumeNotice, setResumeNotice] = useState<number | null>(null)
  /** 自动连播的倒计时；关掉开关或没有下一个时为空。 */
  const [countdown, setCountdown] = useState<number | null>(null)
  const autoplay = useAutoplay((state) => state.enabled)
  const setAutoplay = useAutoplay((state) => state.setEnabled)
  /** 没登录就没有发弹幕资格：把「请先登录或注册」摆在输入框的位置上。 */
  const signedIn = useAuthStore((state) => state.auth !== null)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const onNextRef = useRef(onNext)
  onNextRef.current = onNext

  const speed = usePlayerStore((state) => state.snapshot?.speed ?? 1)
  const setSpeed = usePlayerStore((state) => state.setSpeed)
  const danmakuOn = useDanmakuSettings((s) => s.enabled)
  const danmakuOpacity = useDanmakuSettings((s) => s.opacity)
  const danmakuSize = useDanmakuSettings((s) => s.size)
  const danmakuSpeed = useDanmakuSettings((s) => s.speed)
  const setDanmakuEnabled = useDanmakuSettings((s) => s.setEnabled)
  const patchDanmaku = useDanmakuSettings((s) => s.patch)
  const [danmakuPanel, setDanmakuPanel] = useState(false)

  /** 引擎可能停在另一条视频上（比如这条没打开），别把别人的时间当成本条。 */
  const localPlayhead = (): number => {
    const snap = usePlayerStore.getState().snapshot
    return snap?.track?.key === track.key ? readPlayhead() : 0
  }

  const poke = (): void => {
    setControls(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControls(false), 2500)
  }
  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  // 播完自动进下一个：倒计时期间随时可以手动跳或关掉自动连播。
  useEffect(() => {
    if (!finished || !next || !autoplay) {
      setCountdown(null)
      return
    }
    let left = 5
    setCountdown(left)
    const timer = window.setInterval(() => {
      left -= 1
      setCountdown(left)
      if (left <= 0) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [finished, next, autoplay])

  useEffect(() => {
    if (countdown === 0 && finished && next) onNextRef.current(next)
  }, [countdown, finished, next])

  // 位置只在控制条可见时刷新。隐藏时不跑定时器，省掉整页重渲染。
  useEffect(() => {
    if (!controls) return
    const timer = window.setInterval(() => setNow(Math.round(localPlayhead())), 500)
    return () => window.clearInterval(timer)
  }, [controls])

  /** 上一次单击的时间。双击时要把那次误触发的暂停收回来。 */
  const lastClickAt = useRef(0)

  const togglePlay = (): void => {
    void ipc.playerToggle().catch(() => {
      // 没加载起来时点播放不该静默失败，但也不该假装成功
    })
    poke()
  }

  const seekTo = (ratio: number): void => {
    const duration = data.duration_ms
    if (!duration) return
    const at = Math.round(Math.min(Math.max(ratio, 0), 1) * duration)
    void ipc.playerSeek(at).catch(() => {})
    const v = videoRef.current
    if (v) v.currentTime = at / 1000
    setNow(at)
    poke()
  }

  /** 已经为哪条清单续过播。同一份清单（含降档重载）只续一次。 */
  const resumedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || resumeAt === null) return
    if (resumedFor.current === data.manifest_url) return
    const duration = data.duration_ms || track.duration_ms || 0
    // 太靠前说明只是瞄过一眼，太靠后又基本等于看完了，两种情况都从头放。
    if (!duration || resumeAt < 5000 || resumeAt > duration - 10_000) {
      resumedFor.current = data.manifest_url
      return
    }
    resumedFor.current = data.manifest_url
    seekTo(resumeAt / duration)
    setResumeNotice(resumeAt)
  }, [ready, resumeAt, data.manifest_url, data.duration_ms, track.duration_ms])

  useEffect(() => {
    if (resumeNotice === null) return
    const timer = window.setTimeout(() => setResumeNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [resumeNotice])

  /**
   * 两种「铺满」，和 B 站播放器一一对应：
   * - 网页全屏（W）：画面占满窗口，窗口本身不动，随时能拖走或切别的窗口
   * - 全屏（F）：同上，另外让窗口进系统全屏
   * 两者都靠隐藏应用外壳腾出空间；元素全屏在 WKWebView 里会把 MSE 画黑，不能用。
   */
  const setStageMode = (web: boolean, os: boolean): void => {
    setCinema(web)
    setOsFullscreen(os)
  }

  useEffect(() => {
    // 首次挂载不要把用户自己开的窗口全屏关掉。
    if (!fullscreenSynced.current) {
      fullscreenSynced.current = true
      return
    }
    try {
      void getCurrentWindow().setFullscreen(osFullscreen).catch(() => {})
    } catch {
      // 浏览器预览里没有 Tauri 窗口。
    }
  }, [osFullscreen])

  useEffect(() => {
    return () => {
      useAppStore.getState().setCinema(false)
      useAppStore.getState().setOsFullscreen(false)
      try {
        void getCurrentWindow().setFullscreen(false).catch(() => {})
      } catch {
        // 浏览器预览里没有 Tauri 窗口。
      }
    }
  }, [])

  const sendDanmaku = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const at = Math.round(localPlayhead())
    try {
      await ipc.danmakuSend(track.key, text, at, draftMode, draftColor)
      setDraft('')
      onDanmakuSent({ at, text, color: cssColor(draftColor) })
      poke()
    } catch {
      // 发不出去就留着草稿，不假装成功
    } finally {
      setSending(false)
    }
  }

  // 画面跟随引擎：引擎在放就放，引擎暂停就停，偏差超了拉回来。
  // 只看引擎的状态，不看视频自己的 play/pause，避免两个真值打架。
  useEffect(() => {
    if (!ready) return
    const timer = window.setInterval(() => {
      const v = videoRef.current
      if (!v) return
      const snap = usePlayerStore.getState().snapshot
      // 引擎在放别人的时候，画面不能被它拖着走。
      const sameTrack = snap?.track?.key === track.key
      const enginePlaying = sameTrack && snap?.phase === 'playing'
      setPlaying(enginePlaying)
      setFinished(sameTrack && snap?.phase === 'ended')
      if (!sameTrack || !enginePlaying) {
        if (!v.paused) v.pause()
        return
      }
      const head = readPlayhead()
      const drift = v.currentTime * 1000 - head
      // 画面比声音快：停下来等声音。seek 回去会把缓冲区丢掉，等于用一次卡顿换对齐。
      if (drift > DRIFT_SEEK_MS) {
        if (!v.paused) v.pause()
        return
      }
      if (v.paused) void v.play().catch(() => {})
      // 画面落后太多才 seek 追上；小落后靠加速慢慢追。
      if (drift < -DRIFT_LAG_SEEK_MS) {
        v.currentTime = head / 1000
        v.playbackRate = speed
        return
      }
      // 画面跑快了就放慢一点，落后就加快一点；偏差回到阈值内就恢复原速。
      const wanted =
        Math.abs(drift) > DRIFT_NUDGE_MS
          ? speed * (drift > 0 ? 1 - NUDGE_RATIO : 1 + NUDGE_RATIO)
          : speed
      if (Math.abs(v.playbackRate - wanted) > 0.001) v.playbackRate = wanted
    }, 250)
    return () => window.clearInterval(timer)
  }, [ready, track.key, speed])

  // 换一条视频就重置降档状态：上一部的重试次数不该带到这一部。
  useEffect(() => {
    currentHeight.current = 0
    wantHeight.current = 0
    setRetry(0)
    // 时间与续播提示也属于上一条，跟着清单一起换掉。
    setNow(0)
    setResumeNotice(null)
  }, [data.manifest_url])

  // 挂载 shaka
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const shaka = (window as unknown as { shaka?: ShakaGlobal }).shaka
    if (!shaka) {
      setError('播放器没加载（缺少 shaka-player）')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        shaka.polyfill?.installAll?.()
        const player = new shaka.Player(video)
        playerRef.current = player
        player.addEventListener('error', (event: { detail?: unknown }) => {
          // shaka 的可恢复错误它自己会重试（例如某个分片 404 之后换 CDN）。
          const detail = event.detail as { handled?: boolean } | undefined
          if (detail?.handled) return
          // 这一档取不到就退一档。B 站的 1080P 分片偶尔会被 CDN 直接拒，
          // 让用户自己去画质菜单里试是多余的；低一档几乎总能放。
          const heights = [...new Set(data.qualities.map((q) => q.height))].sort((a, b) => b - a)
          const lower = heights.find((h) => h < (currentHeight.current || heights[0]!))
          if (lower !== undefined && !cancelled) {
            // 先记下这一档，下一次失败才会继续往下退；
            // 否则 load 在选轨之前就失败时会永远停在同一档来回重试。
            currentHeight.current = lower
            wantHeight.current = lower
            setRetry((n) => n + 1)
            return
          }
          setError(describePlaybackError(detail))
        })
        // 缓冲目标放宽：分片要经本机代理去 CDN 取，默认 10 秒的余量
        // 遇到一段网络抖动就会断供，画面上就是「转圈 / 停顿」。
        player.configure?.({
          streaming: { bufferingGoal: 30, rebufferingGoal: 3, bufferBehind: 30 },
        })
        video.muted = true
        video.volume = 0
        await player.load(data.manifest_url)
        // shaka 会自动选一档。把当前档位映射回 B 站的画质 id，
        // 否则按钮上只能显示兜底文案，用户不知道现在是多少。
        if (wantHeight.current > 0) {
          const match = player
            .getVariantTracks()
            .filter((t) => t.height === wantHeight.current)
            .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
          if (match) player.selectVariantTrack(match, true)
          // 没有匹配到就没有「退档成功」可言，别再把它当成当前档。
          else wantHeight.current = 0
        }
        const activeVariant = player.getVariantTracks().find((t) => t.active)
        if (activeVariant) {
          currentHeight.current = activeVariant.height
          const match = data.qualities.find((q) => q.height === activeVariant.height)
          if (match) setActiveId(match.id)
        }
        if (cancelled) {
          await player.destroy()
          return
        }
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(describePlaybackError(e))
      }
    })()
    return () => {
      cancelled = true
      const player = playerRef.current
      playerRef.current = null
      void player?.destroy()
    }
  }, [data, retry])

  // 换档。shaka 按变体轨道的高度匹配，B 站的画质 id 不直接出现在变体上。
  const pickQuality = (q: QualityOption): void => {
    const player = playerRef.current
    if (!player) return
    const same = player.getVariantTracks().filter((t) => t.height === q.height)
    if (same.length === 0) return
    // 同高度可能有多种码率，取最高的那条
    const best = same.sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
    if (!best) return
    player.selectVariantTrack(best, true)
    setActiveId(q.id)
  }

  const duration = data.duration_ms || track.duration_ms || 0
  const percent = Math.min(100, (now / Math.max(1, duration)) * 100)

  return (
    <div
      onMouseMove={poke}
      onMouseLeave={() => setControls(false)}
      className={
        cinema
          ? 'relative flex h-full w-full flex-col justify-center bg-black'
          : 'relative aspect-video w-full shrink-0 bg-black'
      }
    >
      <video
        ref={videoRef}
        muted
        playsInline
        onClick={(event) => {
          // 双击的第二下不再当成暂停，否则双击全屏会顺手把视频停下来。
          if (event.detail > 1) return
          lastClickAt.current = Date.now()
          togglePlay()
        }}
        onDoubleClick={() => {
          // 双击：B 站是网页全屏（不动系统窗口），再双击退出。
          if (Date.now() - lastClickAt.current < 500) togglePlay()
          setStageMode(!cinema, false)
        }}
        className="h-full w-full cursor-pointer object-contain"
        aria-label="视频画面"
      />
      <DanmakuField
        items={danmaku}
        position={() => Math.round(localPlayhead())}
        playing={playing}
        enabled={danmakuOn}
        opacity={danmakuOpacity}
        size={danmakuSize}
        speed={danmakuSpeed}
        fade
      />
      {!ready && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
          <BiliLoader label="正在取流…" />
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center text-[13px] text-white">
          <span>{error}</span>
        </div>
      ) : null}

      {/* 播完掀开的三连。B 站视频放完也是这一张：UP 头像、一句邀请、三个按钮。 */}
      {finished && !error ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/75 px-6 text-center text-white backdrop-blur-[2px]">
          <Avatar src={data.owner_avatar ?? null} alt={data.owner} size={56} />
          <div>
            <div className="text-[15px]">{data.owner}</div>
            <div className="mt-1 text-[13px] text-white/70">喜欢这个视频的话，给个三连吧</div>
          </div>
          <div className="flex items-center gap-2">
            {[
              { on: liked, label: '点赞', run: onLike, icon: <BiliThumb size={16} /> },
              {
                on: coins > 0,
                label: coins >= 2 ? '已投满' : '投币',
                run: onCoin,
                icon: <BiliCoin size={16} />,
                disabled: coins >= 2,
              },
              { on: faved, label: '收藏', run: onFav, icon: <BiliStar size={16} /> },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.run}
                disabled={action.disabled}
                className={`t press flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] ${
                  action.on
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-white/30 text-white hover:border-white/70'
                } disabled:cursor-default disabled:opacity-50`}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onReplay}
              className="t press flex h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] text-white hover:opacity-90"
            >
              <Icon name="refresh" size={15} />
              重播
            </button>
            {next ? (
              <button
                type="button"
                onClick={() => onNext(next)}
                className="t press flex h-9 items-center gap-1.5 rounded-full border border-white/30 px-4 text-[13px] text-white hover:border-white/70"
              >
                <Icon name="play" size={14} />
                下一个
              </button>
            ) : null}
          </div>
          {next ? (
            <div className="flex flex-col items-center gap-1.5">
              {autoplay && countdown !== null ? (
                <button
                  type="button"
                  onClick={() => onNext(next)}
                  className="t max-w-full truncate text-[12px] text-white/65 hover:text-white"
                  title={next.title}
                >
                  {countdown} 秒后自动播放：{next.title}
                </button>
              ) : null}
              <label className="flex items-center gap-1.5 text-[12px] text-white/55">
                <input
                  type="checkbox"
                  checked={autoplay}
                  onChange={(event) => setAutoplay(event.target.checked)}
                  className="accent-[var(--accent)]"
                />
                自动连播
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {resumeNotice !== null ? (
        <div className="absolute bottom-14 left-3 z-30 flex items-center gap-3 rounded-[4px] bg-black/80 px-3 py-1.5 text-[12px] text-white">
          <span className="num">已为你定位至上次观看位置 {formatTime(resumeNotice)}</span>
          <button
            type="button"
            onClick={() => {
              seekTo(0)
              setResumeNotice(null)
            }}
            className="t press shrink-0 text-[var(--accent)] hover:underline"
          >
            撤销
          </button>
        </div>
      ) : null}

      {/* 控制条浮在画面上：鼠标移上来才出现，静止就淡出。
          常驻一条控制条会把画面挤小，视频网站都不这么做。 */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-1.5 pt-10 text-white transition-opacity duration-200 ${
          controls || !playing ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* 窄屏把发弹幕单独放一行：控制条一行塞不下输入框，挤压后会与画面字幕糊在一起。 */}
        <div className="mb-1.5 flex items-center gap-2 md:hidden">
          {!signedIn ? (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[4px] px-1 text-[12px] text-white/60 hover:text-white"
            >
              请先
              <span className="text-[var(--accent)]">登录</span>
              或
              <span className="text-[var(--accent)]">注册</span>
            </button>
          ) : (
            <>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void sendDanmaku()
            }}
            placeholder="发一条友善的弹幕"
            aria-label="发弹幕"
            className="h-7 min-w-0 flex-1 rounded-[4px] bg-black/45 px-2 text-[12px] text-white placeholder-white/60 outline-none focus:bg-black/60"
          />
          <button
            type="button"
            onClick={() => void sendDanmaku()}
            disabled={!draft.trim() || sending}
            className="t press h-7 shrink-0 rounded-[4px] bg-[var(--accent)] px-2 text-[12px] text-white disabled:opacity-40"
          >
            发送
          </button>
            </>
          )}
        </div>

        <div
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          tabIndex={0}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            seekTo((event.clientX - box.left) / box.width)
          }}
          // 标成 slider 就必须能被键盘操作：Home/End 跳到两端，
          // 方向键按 5 秒走。缺这一段，读屏和纯键盘用户完全拖不动进度。
          onKeyDown={(event) => {
            if (!data.duration_ms) return
            const step = event.shiftKey ? 30_000 : 5_000
            const at = localPlayhead()
            const keys: Record<string, number | undefined> = {
              Home: 0,
              // 正好落在 duration 上会被解码器当成越界忽略，留 1.5 秒。
              End: Math.max(0, 1 - 1500 / data.duration_ms),
              ArrowLeft: (at - step) / data.duration_ms,
              ArrowDown: (at - step) / data.duration_ms,
              ArrowRight: (at + step) / data.duration_ms,
              ArrowUp: (at + step) / data.duration_ms,
            }
            const target = keys[event.key]
            if (target === undefined) return
            event.preventDefault()
            seekTo(target)
          }}
          className="group relative mb-1.5 h-3 cursor-pointer"
        >
          <DanmakuBeats items={danmaku} durationMs={duration} />
          <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-white/25" />
          <span
            /* B 站播放器的进度条是品牌粉，不是链接蓝。 */
            className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--accent)]"
            style={{ width: `${percent}%` }}
          />
          <span
            className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            style={{ left: `${percent}%` }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? '暂停' : '播放'}
            className="bili-icon-btn t press flex h-[22px] w-9 items-center justify-center rounded-[4px] hover:bg-white/15"
          >
            <Icon name={playing ? 'pause' : 'play'} size={15} />
          </button>
          <span className="num shrink-0 text-[12px] text-white/80">
            {formatTime(now)} / {formatTime(duration)}
          </span>

          <div className="min-w-0 flex-1" />

          <div className="hidden items-center gap-2 md:flex">
            {/*
             * 未登录时 B 站不给输入框，而是把「请先登录或注册」摊在同一行：
             * 让人能打字再说「发送失败」是最差的一种。登录态取不到也按未登录处理。
             */}
            {!signedIn ? (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="flex h-7 shrink-0 items-center gap-1 rounded-[4px] px-1 text-[12px] text-white/60 hover:text-white"
              >
                请先
                <span className="text-[var(--accent)] hover:underline">登录</span>
                或
                <span className="text-[var(--accent)] hover:underline">注册</span>
              </button>
            ) : (
              <>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendDanmaku()
              }}
              placeholder="发一条友善的弹幕"
              aria-label="发弹幕"
              className="h-7 w-[150px] shrink-0 rounded-[4px] bg-black/45 px-2 text-[12px] text-white placeholder-white/60 outline-none focus:bg-black/60"
            />
            <button
              type="button"
              onClick={() => setDraftPicker((open) => !open)}
              aria-expanded={draftPicker}
              aria-label="弹幕颜色与位置"
              title="弹幕颜色与位置"
              className={`bili-icon-btn t press flex h-[22px] w-9 shrink-0 items-center justify-center rounded-[4px] ${
                draftPicker ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/15'
              }`}
            >
              <span
                className="block h-3.5 w-3.5 rounded-full border border-white/60"
                style={{ background: cssColor(draftColor) }}
              />
            </button>
            <button
              type="button"
              onClick={() => void sendDanmaku()}
              disabled={!draft.trim() || sending}
              className="t press h-7 shrink-0 rounded-[4px] bg-[var(--accent)] px-2 text-[12px] text-white disabled:opacity-40"
            >
              发送
            </button>
              </>
            )}
            {draftPicker ? (
              <div className="absolute bottom-9 right-2 z-30 w-[212px] rounded-[6px] border border-white/15 bg-black/90 p-3 text-white backdrop-blur">
                <div className="mb-2 flex items-center justify-between text-[11px] text-white/70">
                  <span>颜色</span>
                  <span>{DANMAKU_MODES.find((m) => m.value === draftMode)?.name}</span>
                </div>
                <div className="grid grid-cols-8 gap-1.5">
                  {DANMAKU_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      aria-label={`弹幕颜色 ${color.name}`}
                      aria-pressed={draftColor === color.value}
                      onClick={() => setDraftColor(color.value)}
                      className={`h-4 w-4 rounded-full border ${
                        draftColor === color.value ? 'border-white ring-1 ring-white' : 'border-white/40'
                      }`}
                      style={{ background: cssColor(color.value) }}
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  {DANMAKU_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      aria-pressed={draftMode === mode.value}
                      onClick={() => setDraftMode(mode.value)}
                      className={`t press flex-1 rounded-[4px] py-1 text-[11px] ${
                        draftMode === mode.value
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-white/10 text-white/80 hover:bg-white/20'
                      }`}
                    >
                      {mode.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            aria-pressed={danmakuOn}
            title={danmakuOn ? '关闭弹幕' : '打开弹幕'}
            onClick={() => setDanmakuEnabled(!danmakuOn)}
            className={`t press flex h-7 shrink-0 items-center rounded-[4px] px-2 text-[12px] ${
              danmakuOn ? 'bg-white/20' : 'text-white/60 hover:bg-white/10'
            }`}
          >
            弹
          </button>

          {/* 弹幕设置。B 站播放器在「弹」旁边就是这个齿轮，四项可调。 */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setQualityOpen(false)
                setDanmakuPanel((open) => !open)
              }}
              aria-expanded={danmakuPanel}
              aria-label="弹幕设置"
              title="弹幕设置"
              className={`bili-icon-btn t press flex h-[22px] w-9 items-center justify-center rounded-[4px] ${
                danmakuPanel ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/15'
              }`}
            >
              <Icon name="settings" size={14} />
            </button>
            {danmakuPanel ? (
              <div className="absolute bottom-9 right-0 z-30 w-[196px] rounded-[6px] border border-white/15 bg-black/90 p-3 text-white backdrop-blur">
                {(
                  [
                    { key: 'opacity', label: '不透明度', min: 0.2, max: 1, step: 0.1, value: danmakuOpacity },
                    { key: 'size', label: '字号', min: 11, max: 20, step: 1, value: danmakuSize },
                    { key: 'speed', label: '速度', min: 0.6, max: 2, step: 0.2, value: danmakuSpeed },
                  ] as const
                ).map((row) => (
                  <label key={row.key} className="mb-2 block last:mb-0">
                    <span className="flex items-center justify-between text-[11px] text-white/70">
                      {row.label}
                      <span className="num">{row.key === 'opacity' ? `${Math.round(row.value * 100)}%` : row.value}</span>
                    </span>
                    <input
                      type="range"
                      min={row.min}
                      max={row.max}
                      step={row.step}
                      value={row.value}
                      onChange={(event) => patchDanmaku({ [row.key]: Number(event.target.value) })}
                      className="mt-1 w-full accent-[var(--accent)]"
                    />
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number])
              void setSpeed(SPEEDS[(i + 1) % SPEEDS.length] ?? 1)
            }}
            title="播放倍速"
            aria-label={`播放倍速 ${speed}x`}
            className="t press num hidden h-7 shrink-0 rounded-[4px] px-2 text-[12px] hover:bg-white/15 md:block"
          >
            {speed}x
          </button>

          {/* 音量与倍速在窄屏交给系统：手机上调的是系统音量，不是应用音量。 */}
          <span
            className="hidden shrink-0 items-center md:flex"
            style={{ ['--text-2' as string]: 'rgb(255 255 255 / 0.85)' }}
          >
            <VolumeControl />
          </span>

          {data.qualities.length > 0 ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDanmakuPanel(false)
                  setQualityOpen((open) => !open)
                }}
                aria-expanded={qualityOpen}
                className="t press flex h-7 items-center rounded-[4px] px-2 text-[12px] hover:bg-white/15"
              >
                {data.qualities.find((q) => q.id === activeId)?.label ?? '画质'}
              </button>
              {qualityOpen ? (
                <div className="absolute bottom-8 right-0 z-30 flex max-h-[220px] w-[104px] flex-col overflow-y-auto rounded-[6px] border border-white/15 bg-black/90 py-1 backdrop-blur">
                  {data.qualities.map((q) => (
                    <button
                      key={`${q.id}-${q.height}`}
                      type="button"
                      onClick={() => {
                        pickQuality(q)
                        setQualityOpen(false)
                      }}
                      className={`t press px-2 py-1 text-left text-[12px] ${
                        activeId === q.id ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/10'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* B 站播放器在这两个位置摆的是「网页全屏」和「全屏」。
              桌面端也保留这个层次：前者只铺满窗口，后者再进系统全屏。 */}
          <button
            type="button"
            onClick={() => setStageMode(!cinema, false)}
            aria-label={cinema && !osFullscreen ? '退出网页全屏' : '网页全屏'}
            title="网页全屏（W）"
            className={`bili-icon-btn t press flex h-[22px] w-9 shrink-0 items-center justify-center rounded-[4px] ${
              cinema && !osFullscreen ? 'text-[var(--accent)]' : 'hover:bg-white/15'
            }`}
          >
            <Icon name="fullscreen" size={13} />
          </button>
          <button
            type="button"
            onClick={() => (osFullscreen ? setStageMode(false, false) : setStageMode(true, true))}
            aria-label={osFullscreen ? '退出全屏' : '全屏'}
            title="全屏（F）"
            className="bili-icon-btn t press flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] hover:bg-white/15"
          >
            <Icon name={osFullscreen ? 'close' : 'fullscreen'} size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
