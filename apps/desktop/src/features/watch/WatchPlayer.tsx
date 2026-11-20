import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from '../../app/appStore'
import { toastDone, toastFailure } from '../../app/notice'
import { reportActionError } from '../../shared/lib/actionError'
import * as ipc from '../../shared/lib/ipc'
import type { QualityOption, Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount, formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { copyText } from '../../shared/lib/clipboard'
import { chaptersFrom, type Chapter } from '../../shared/lib/chapters'
import { DanmakuField } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { DanmakuBeats } from '../player/DanmakuBeats'
import { useDanmakuSettings } from '../player/danmakuSettings'
import { useAuthStore } from '../auth/authStore'
import { useAutoplay, useLoopOne } from './autoplay'
import { usePlayerStore } from '../player/playerStore'
import { VolumeControl } from '../player/VolumeControl'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { Modal } from '../../shared/ui/Modal'
import { BiliDanmakuSetting, BiliDanmakuSwitch } from '../../shared/ui/BiliDanmakuIcons'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'
import type { ShakaGlobal, ShakaPlayer } from './shaka'

/** 观看页的倍速档位，和 B 站播放器一致。 */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
/**
 * 音画偏差的三段处理。
 *
 * 硬 seek 会让 MSE 丢掉已缓冲的分片、立刻重新拉流，观感就是「一顿」。
 * 所以只有偏差大到看得出来（>1.2 秒）才 seek；几百毫秒的偏差靠轻微改变
 * 画面播放速度慢慢追，观众察觉不到，缓冲区也不会被打断。
 */
const DRIFT_SEEK_MS = 1200
const DRIFT_NUDGE_MS = 80
/**
 * 画面落后声音多少才值得 seek。
 *
 * 画面跑快时**不能** seek：那会把已经缓冲好的分片全丢掉，再重新拉一遍，
 * 观感就是一顿。让它原地等一下声音就行。只有画面落后太多（跳转、解码卡顿）
 * 才值得往前追。
 */
const DRIFT_LAG_SEEK_MS = 1500
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

/** 弹幕可出现的画面高度，和 B 站播放器一样分三档。 */
const DANMAKU_AREAS = [
  { name: '1/4', value: 0.25 },
  { name: '1/2', value: 0.5 },
  { name: '全屏', value: 1 },
] as const

const cssColor = (value: number): string => `#${value.toString(16).padStart(6, '0')}`

/**
 * 上次选的画质。B 站网页端会记住这个偏好，下次进视频直接用。
 *
 * 画质 id 是 B 站全局的档位编号（80=1080P、112=1080P+），跨视频通用；
 * 只存高度会把同高的 1080P 和 1080P+ 混成一个，下次打开就落到高码率那档。
 */
const QUALITY_KEY = 'bilimusic.quality'
const QUALITY_ID_KEY = 'bilimusic.quality.id'

function loadQualityId(): number {
  try {
    return Number(localStorage.getItem(QUALITY_ID_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function loadQualityHeight(): number {
  try {
    return Number(localStorage.getItem(QUALITY_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function saveQualityId(id: number): void {
  try {
    localStorage.setItem(QUALITY_ID_KEY, String(id))
  } catch {
    // 隐私模式写不进去，只影响这次会话
  }
}

function saveQualityHeight(height: number): void {
  try {
    localStorage.setItem(QUALITY_KEY, String(height))
  } catch {
    // 隐私模式写不进去，只影响这次会话
  }
}

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
function DanmakuComposer({
  tone,
  signedIn,
  onLogin,
  value,
  onChange,
  onSend,
  sending,
  inputClass = '',
}: {
  tone: 'dark' | 'light'
  signedIn: boolean
  onLogin: () => void
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
  inputClass?: string
}) {
  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={onLogin}
        className={`flex h-8 min-w-0 flex-1 items-center gap-1 rounded-[4px] px-2 text-[12px] ${
          tone === 'dark' ? 'text-white/60 hover:text-white' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
        }`}
      >
        请先
        <span className="text-[var(--accent)]">登录</span>
        或
        <span className="text-[var(--accent)]">注册</span>
      </button>
    )
  }

  return (
    <>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSend()
        }}
        placeholder="发个友善的弹幕见证当下"
        aria-label="发弹幕"
        className={`h-8 min-w-0 rounded-[4px] border px-2 text-[12px] outline-none transition-colors ${
          tone === 'dark'
            ? 'border-white/15 bg-white/[0.08] text-white placeholder-white/55 hover:border-white/25 hover:bg-white/[0.12] focus:border-[var(--accent)] focus:bg-white/[0.12]'
            : 'border-[var(--line)] bg-[var(--panel)] text-[var(--text-1)] placeholder-[var(--text-3)] hover:border-[var(--accent)] focus:border-[var(--accent)]'
        } ${inputClass}`}
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!value.trim() || sending}
        aria-label="发送"
        className="t press flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-[var(--accent)] text-white disabled:opacity-40"
      >
        <Icon name="send" size={14} />
      </button>
    </>
  )
}

/** 冒烟脚本读的播放器状态；只在 dev 构建挂到 window 上。 */
type WatchProbe = {
  state: () => {
    now: number
    duration: number
    scrub: number | null
    playing: boolean
    ready: boolean
    error: string | null
    lastSeek: number | null
  }
}

/** 播完后那张「即将播放」卡要用的字段。 */
export type NextUp = {
  title: string
  owner: string
  cover: string | null
  views: number | null
  durationMs: number | null
  /** 多 P 时是下一 P 的序号；相关推荐为 null。 */
  page: number | null
}

export function WatchPlayer({
  track,
  data,
  online,
  danmaku,
  subtitleTracks,
  onDanmakuSent,
  onLike,
  onFav,
  onCoin,
  onReplay,
  nextUp,
  onNext,
  seekSignal,
  currentPage,
  onPage,
  resumeAt,
  chapters: chapterMeta,
  liked,
  faved,
  coins,
}: {
  track: Track
  data: WatchData
  online: number | null
  danmaku: DanmakuItem[]
  /** 这条视频的可用字幕轨。空表示没有字幕，控制条上就不出现「字幕」按钮。 */
  subtitleTracks: ipc.SubtitleTrack[]
  onDanmakuSent: (item: DanmakuItem) => void
  /** 播完之后的收尾。B 站也是在这时候把三连与重播摆到画面上。 */
  onLike: () => void
  onFav: () => void
  /** 已投出去的币数，0/1/2。三连里投币要按真实状态置灰。 */
  onCoin: () => void
  onReplay: () => void
  /** 播完后的下一集标题；多 P 先走下一 P，否则走相关推荐。 */
  nextUp: NextUp | null
  onNext: () => void
  /** 外部点时间戳时发来的一次定位；播放器自己改声音与画面，保证暂停时也立刻落位。 */
  seekSignal: { at: number; nonce: number } | null
  /** 多 P 时控制条上的选集。 */
  currentPage: number
  onPage: (no: number) => void
  /** 上次看到的位置，毫秒。太靠前或太靠后播放器会自己放弃。 */
  resumeAt: number | null
  /** UP 主设的章节；空表时退回简介里的时间戳。 */
  chapters: Chapter[]
  liked: boolean
  faved: boolean
  coins: number
}) {
  const nextTitle = nextUp?.title ?? null
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<ShakaPlayer | null>(null)
  const hideTimer = useRef<number | null>(null)
  const fullscreenSynced = useRef(false)
  /** 冒烟脚本读的最后一次落位；播放时钟在无头预览里没有真值。 */
  const lastSeek = useRef<number | null>(null)
  /** 当前生效的变体高度，降档时用它找下一档。 */
  const currentHeight = useRef<number>(0)
  /** 出错后想降到的目标高度；为 0 表示按 shaka 的默认选择。 */
  const wantHeight = useRef<number>(0)
  const [retry, setRetry] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  /** 播放器自己报的缓冲态：卡住时画面上要有转圈，不然只能看到画面定格。 */
  const [buffering, setBuffering] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [controls, setControls] = useState(true)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [now, setNow] = useState(0)
  /**
   * 字幕：开着哪一轨（null 表示关）。台词只在打开时取一次，
   * 不在每次进视频都白拉一份 JSON——多数字幕轨是 AI 生成的长列表。
   */
  const [subTrack, setSubTrack] = useState<string | null>(null)
  const [subCues, setSubCues] = useState<ipc.SubtitleCue[] | null>(null)
  const [subMenu, setSubMenu] = useState(false)
  const [draft, setDraft] = useState('')
  /** 发弹幕的位置；颜色跨视频沿用设置里的偏好。 */
  const [draftMode, setDraftMode] = useState(1)
  const [sending, setSending] = useState(false)
  const cinema = useAppStore((state) => state.cinema)
  const setCinema = useAppStore((state) => state.setCinema)
  const osFullscreen = useAppStore((state) => state.osFullscreen)
  const setOsFullscreen = useAppStore((state) => state.setOsFullscreen)
  const [playing, setPlaying] = useState(false)
  /** 播到结尾就掀开三连面板。 */
  const [finished, setFinished] = useState(false)
  /** 仅开发页：`?forceEnded=1` 直接把结束卡拉起来，用来验自动连播与取消。 */
  const forceEnded =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('forceEnded')
  const ended = finished || forceEnded
  /** 「已为你定位」提示里显示的位置；null 表示这条不该续播或用户已经撤销。 */
  const [resumeNotice, setResumeNotice] = useState<number | null>(null)
  /** 自动连播的倒计时；关掉开关或没有下一个时为空。 */
  const [countdown, setCountdown] = useState<number | null>(null)
  /** 只取消这一次自动连播，不改「自动连播」偏好。 */
  const [countdownCancelled, setCountdownCancelled] = useState(false)
  /** 鼠标停在倒计时行上时冻结倒计时，给「取消」留出点击时间。 */
  const countdownHovered = useRef(false)
  const [countdownHover, setCountdownHover] = useState(false)
  const nextFired = useRef(false)
  const autoplay = useAutoplay((state) => state.enabled)
  const setAutoplay = useAutoplay((state) => state.setEnabled)
  const loopOne = useLoopOne((state) => state.enabled)
  const setLoopOne = useLoopOne((state) => state.setEnabled)
  /** 没登录就没有发弹幕资格：把「请先登录或注册」摆在输入框的位置上。 */
  const signedIn = useAuthStore((state) => state.auth !== null)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const onNextRef = useRef(onNext)
  onNextRef.current = onNext
  const advance = (): void => {
    if (nextFired.current) return
    nextFired.current = true
    onNextRef.current()
  }
  const onReplayRef = useRef(onReplay)
  onReplayRef.current = onReplay

  const speed = usePlayerStore((state) => state.snapshot?.speed ?? 1)
  const setSpeed = usePlayerStore((state) => state.setSpeed)
  const danmakuOn = useDanmakuSettings((s) => s.enabled)
  const danmakuOpacity = useDanmakuSettings((s) => s.opacity)
  const danmakuSize = useDanmakuSettings((s) => s.size)
  const danmakuSpeed = useDanmakuSettings((s) => s.speed)
  const danmakuArea = useDanmakuSettings((s) => s.area)
  const danmakuBlockWords = useDanmakuSettings((s) => s.blockWords)
  const danmakuBlockTypes = useDanmakuSettings((s) => s.blockTypes)
  const sendColor = useDanmakuSettings((s) => s.sendColor)
  const setDanmakuEnabled = useDanmakuSettings((s) => s.setEnabled)
  const patchDanmaku = useDanmakuSettings((s) => s.patch)
  const setDanmakuBlockWords = useDanmakuSettings((s) => s.setBlockWords)
  const toggleDanmakuBlockType = useDanmakuSettings((s) => s.toggleBlockType)
  const setSendColor = useDanmakuSettings((s) => s.setSendColor)
  const [danmakuPanel, setDanmakuPanel] = useState(false)
  const [blockDraft, setBlockDraft] = useState('')

  /** 屏蔽词和屏蔽类型只作用于画面上的弹幕，右栏列表仍保留全部。 */
  const visibleDanmaku = useMemo(() => {
    const words = danmakuBlockWords.map((word) => word.trim().toLowerCase()).filter(Boolean)
    const types = new Set(danmakuBlockTypes)
    if (words.length === 0 && types.size === 0) return danmaku
    return danmaku.filter((item) => {
      const type = item.mode === 5 ? 'top' : item.mode === 4 ? 'bottom' : 'roll'
      if (types.has(type)) return false
      const text = item.text.toLowerCase()
      return !words.some((word) => text.includes(word))
    })
  }, [danmaku, danmakuBlockWords, danmakuBlockTypes])

  const addBlockWords = (): void => {
    const words = blockDraft
      .split(/[\s,，]+/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean)
    if (words.length === 0) return
    setDanmakuBlockWords([...new Set([...danmakuBlockWords, ...words])])
    setBlockDraft('')
  }

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
    if (!seekSignal) return
    const video = videoRef.current
    if (video) video.currentTime = seekSignal.at / 1000
    setNow(seekSignal.at)
    void ipc.playerSeek(seekSignal.at).catch(() => {})
  }, [seekSignal])
  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  // 播完自动进下一个：倒计时期间随时可以手动跳或关掉自动连播。
  useEffect(() => {
    if (!ended) nextFired.current = false
  }, [ended])

  useEffect(() => {
    if (!ended || !nextTitle || !autoplay || loopOne || nextFired.current) {
      setCountdown(null)
      setCountdownCancelled(false)
      return
    }
    if (countdownCancelled) {
      setCountdown(null)
      return
    }
    let left = 5
    setCountdown(left)
    const timer = window.setInterval(() => {
      if (countdownHovered.current) return
      left -= 1
      setCountdown(left)
      if (left <= 0) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [ended, nextTitle, autoplay, loopOne, countdownCancelled])

  /**
   * 单集循环：播完直接把时间拉回 0 继续放。
   * 必须排在自动连播之后判断，否则循环开着还会先闪一下倒计时。
   */
  useEffect(() => {
    if (!ended || !loopOne) return
    const timer = window.setTimeout(() => {
      onReplayRef.current()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [ended, loopOne])

  useEffect(() => {
    if (countdown === 0 && ended && nextTitle && !countdownCancelled && !countdownHovered.current) {
      advance()
    }
  }, [countdown, countdownHover, ended, nextTitle, countdownCancelled])

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
    const duration = data.duration_ms || track.duration_ms || 0
    if (!duration) return
    const at = Math.round(Math.min(Math.max(ratio, 0), 1) * duration)
    lastSeek.current = at
    void ipc.playerSeek(at).catch(() => {})
    const v = videoRef.current
    if (v) v.currentTime = at / 1000
    setNow(at)
    poke()
  }

  /** 已经为哪条清单续过播。同一份清单（含降档重载）只续一次。 */
  const resumedFor = useRef<string | null>(null)
  /** 已经为哪份清单补过续播 seek；切 P 换清单后可以再补一次。 */
  const resumeSeekedFor = useRef<string | null>(null)
  /** 声音真的开始走之前的进度锚点；画面要等它越过锚点才起播。 */
  const audioAnchor = useRef<number | null>(null)
  const audioLive = useRef(false)
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
    // 声音已经在 resume_at_ms 起播，这里再把音频 seek 回去会倒带已播的部分。
    // 只把画面对齐到声音的当前进度；声音若还没加载好，就落在续播点上等它。
    const head = localPlayhead()
    const at = head > resumeAt ? head : resumeAt
    const v = videoRef.current
    if (v) v.currentTime = at / 1000
    setNow(at)
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

  /** 当前这一 P 的 cid：弹幕、字幕、预览图都按它取。 */
  const cid = data.pages.find((p) => p.no === data.current_page)?.cid ?? data.pages[0]?.cid ?? 0

  const sendDanmaku = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const at = Math.round(localPlayhead())
    try {
      const cid = data.pages.find((page) => page.no === currentPage)?.cid
      await ipc.danmakuSend(track.key, text, at, draftMode, sendColor, cid)
      setDraft('')
      onDanmakuSent({ at, text, color: cssColor(sendColor), mode: draftMode })
      poke()
    } catch (cause) {
      // 草稿留着，但失败原因要说出来：B 站限流时静默不动，看起来就是「点了没反应」。
      reportActionError('发弹幕', cause)
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
      // 拉流时状态已经是 playing，但声卡可能还没拿到第一个样本。这时先让画面
      // 停住，等音频时钟真的走起来，再把画面接到同一个位置起播。
      if (!audioLive.current) {
        const reported = usePlayerStore.getState().progress.position_ms
        if (audioAnchor.current === null) audioAnchor.current = reported
        if (reported < audioAnchor.current + 150) {
          if (!v.paused) v.pause()
          return
        }
        audioLive.current = true
        v.currentTime = reported / 1000
      }
      const head = readPlayhead()
      // 切 P 时引擎偶尔从 0 起播（续播点没有落到这一条流上）。等声音真的
      // 走起来再补一次 seek，保证声音和画面都回到记录的位置。
      if (
        resumeAt !== null &&
        resumeSeekedFor.current !== data.manifest_url &&
        head > 500 &&
        head + 3000 < resumeAt
      ) {
        resumeSeekedFor.current = data.manifest_url
        void ipc.playerSeek(resumeAt).catch(() => {})
        return
      }
      const drift = v.currentTime * 1000 - head
      // 重播时画面还停在片尾、声音已从头走：这个差距等不回来，直接拉回声音位置。
      if (drift > 5000) {
        v.currentTime = head / 1000
        void v.play().catch(() => {})
        return
      }
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
  }, [ready, track.key, speed, resumeAt, data.manifest_url])

  // 换一条视频就重置降档状态：上一部的重试次数不该带到这一部。
  useEffect(() => {
    currentHeight.current = 0
    wantHeight.current = 0
    setRetry(0)
    audioAnchor.current = null
    audioLive.current = false
    // 字幕属于上一条：换片就该关掉，别把上一部的台词挂在新画面上。
    setSubTrack(null)
    setSubMenu(false)
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
        player.addEventListener('buffering', (event: { detail?: unknown }) => {
          const detail = event.detail as { buffering?: boolean } | undefined
          if (!cancelled) setBuffering(Boolean(detail?.buffering))
        })
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
        // 降档重试优先；没有降档就按上次选的档位来。
        const preferredId = loadQualityId()
        const preferredQuality = data.qualities.find((q) => q.id === preferredId)
        const preferred = wantHeight.current || preferredQuality?.height || loadQualityHeight()
        if (preferred > 0) {
          const variants = player.getVariantTracks().filter((t) => (t.height ?? 0) > 0)
          const exact = variants
            .filter((t) => t.height === preferred)
            .sort((a, b) => {
              if (!preferredQuality) return (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
              return (
                Math.abs((a.bandwidth ?? 0) - preferredQuality.bandwidth) -
                Math.abs((b.bandwidth ?? 0) - preferredQuality.bandwidth)
              )
            })[0]
          // 这条视频没有那一档（上次选了 1080P、这条最高 720P）就退到不超过它的最高档。
          const lower = variants
            .filter((t) => (t.height ?? 0) < preferred)
            .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
          const match = exact ?? lower
          if (match) player.selectVariantTrack(match, true)
          // 没有匹配到就没有「退档成功」可言，别再把它当成当前档。
          else wantHeight.current = 0
        }
        const activeVariant = player.getVariantTracks().find((t) => t.active)
        if (activeVariant) {
          currentHeight.current = activeVariant.height
          const match = data.qualities
            .filter((q) => q.height === activeVariant.height)
            .sort(
              (a, b) =>
                Math.abs(a.bandwidth - (activeVariant.bandwidth ?? 0)) -
                Math.abs(b.bandwidth - (activeVariant.bandwidth ?? 0)),
            )[0]
          if (match) setActiveId(match.id)
        }
        if (cancelled) {
          await player.destroy()
          return
        }
        setBuffering(false)
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
  // 1080P 与 1080P+ 同高，只能再按码率找最近的一条；只按高度会永远选到高码率那档。
  const pickQuality = (q: QualityOption): void => {
    const player = playerRef.current
    if (!player) return
    const same = player.getVariantTracks().filter((t) => t.height === q.height)
    if (same.length === 0) return
    const best =
      q.bandwidth > 0
        ? same.sort(
            (a, b) =>
              Math.abs((a.bandwidth ?? 0) - q.bandwidth) -
              Math.abs((b.bandwidth ?? 0) - q.bandwidth),
          )[0]
        : same.sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
    if (!best) return
    player.selectVariantTrack(best, true)
    setActiveId(q.id)
    saveQualityId(q.id)
    saveQualityHeight(q.height)
  }

  /** 某个时刻落在哪一章。章节按时间升序，取最后一个不超过它的。 */
  const chapterAt = (ms: number): { at: number; title: string } | null => {
    let hit: { at: number; title: string } | null = null
    for (const chapter of chapters) {
      if (chapter.at > ms) break
      hit = chapter
    }
    return hit
  }

  /** 正在拖动进度条时指针所在的百分比；null 表示没在拖。 */
  const [scrub, setScrub] = useState<number | null>(null)
  const duration = data.duration_ms || track.duration_ms || 0
  const percent = Math.min(100, (now / Math.max(1, duration)) * 100)
  /** 拖动时进度条与时间跟着指针走，松手才真的落位。 */
  const shownPercent = scrub === null ? percent : scrub * 100

  // 冒烟脚本读的探针。无头预览取不到流，播放时钟始终是 0，seek 之后
  // 500ms 就被它覆盖回去，只能让播放器自己报出收过的落点。
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const probe: WatchProbe = {
      state: () => ({ now, duration, scrub, playing, ready, error, lastSeek: lastSeek.current }),
    }
    ;(window as unknown as { __ohBilibiliWatch?: WatchProbe }).__ohBilibiliWatch = probe
    return () => {
      delete (window as unknown as { __ohBilibiliWatch?: WatchProbe }).__ohBilibiliWatch
    }
  }, [now, duration, scrub, playing, ready, error])

  /** 当前该显示哪句字幕。台词按开始时间升序，取最后一条已经开始的。 */
  const cue = (() => {
    if (!subCues || subCues.length === 0) return null
    const at = now
    let lo = 0
    let hi = subCues.length - 1
    let hit: ipc.SubtitleCue | null = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const line = subCues[mid]!
      if (line.at_ms <= at) {
        hit = line
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    // 已经过了这句的结束时间就是空档，不该把上一句一直挂着。
    return hit && at <= hit.end_ms ? hit : null
  })()

  // 打开字幕时取台词；关掉就清空，避免下次换轨还显示旧的一轨。
  useEffect(() => {
    if (subTrack === null) {
      setSubCues(null)
      return
    }
    let cancelled = false
    setSubCues(null)
    void ipc
      .watchSubtitles(track.key, subTrack, cid)
      .then((cues) => {
        if (!cancelled) setSubCues(cues)
      })
      .catch(() => {
        if (!cancelled) setSubCues([])
      })
    return () => {
      cancelled = true
    }
    // 字幕按 P 分，切 P 必须重取：语言代码通常一样，少了 cid 就会一直挂着上一集。
  }, [subTrack, track.key, cid])

  /** 章节优先用 UP 主设的，没设过再看简介里有没有时间戳。 */
  const chapters = chapterMeta.length > 0 ? chapterMeta : chaptersFrom(data.desc)
  const pageTitle = data.pages.find((page) => page.no === currentPage)?.title ?? ''

  /** 进度条悬停预览。整条视频的雪碧图只在第一次悬停时取，平时不发请求。 */
  const [shots, setShots] = useState<ipc.VideoShots | null>(null)
  const shotsAsked = useRef(false)
  // 预览图按 P 分，换 P 要重新要；否则悬停显示的是上一集的时间轴。
  useEffect(() => {
    shotsAsked.current = false
    setShots(null)
  }, [cid])
  const [hoverAt, setHoverAt] = useState<{ ratio: number; second: number; width: number } | null>(null)
  /** 右键菜单的位置；null 表示没开。 */
  const [shotMenu, setShotMenu] = useState<{ x: number; y: number } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  /** 镜像画面只翻转视频元素，弹幕和字幕保持正向。 */
  const [mirror, setMirror] = useState(false)
  const [statsOn, setStatsOn] = useState(false)
  const [stats, setStats] = useState<{
    width: number
    height: number
    dropped: number
    buffer: number
    rate: number
  } | null>(null)

  useEffect(() => {
    if (!shotMenu) return
    const close = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-shot-menu]')) return
      setShotMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [shotMenu])

  useEffect(() => {
    if (!statsOn) {
      setStats(null)
      return
    }
    const refresh = (): void => {
      const video = videoRef.current
      if (!video) return
      const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
      setStats({
        width: video.videoWidth,
        height: video.videoHeight,
        dropped:
          (video as HTMLVideoElement & { webkitDroppedFrameCount?: number })
            .webkitDroppedFrameCount ?? 0,
        buffer: Math.max(0, end - video.currentTime),
        rate: video.playbackRate,
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => window.clearInterval(timer)
  }, [statsOn])

  const copyWatchLink = (): void => {
    setShotMenu(null)
    void copyText(`https://www.bilibili.com/video/${track.key}`).then((ok) =>
      toastDone(ok ? '已复制视频链接' : '复制失败'),
    )
  }

  const copyCurrentTime = (): void => {
    setShotMenu(null)
    void copyText(formatTime(Math.round(localPlayhead()))).then((ok) =>
      toastDone(ok ? '已复制当前时间' : '复制失败'),
    )
  }

  const captureShot = (): void => {
    setShotMenu(null)
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      toastFailure('截图', new Error('画面还没准备好'))
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      toastFailure('截图', new Error('浏览器不支持画布'))
      return
    }
    try {
      context.drawImage(video, 0, 0)
    } catch (e) {
      toastFailure('截图', e)
      return
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        toastFailure('截图', new Error('生成图片失败'))
        return
      }
      void (async () => {
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
        const at = Math.round(localPlayhead())
        const path = await ipc.saveScreenshot(bytes, `${track.title}-${formatTime(at)}`)
        toastDone('截图已保存', path)
      })().catch((e) => toastFailure('截图', e))
    }, 'image/png')
  }

  const askShots = (): void => {
    if (shotsAsked.current || !cid) return
    shotsAsked.current = true
    void ipc
      .videoShots(track.key, cid)
      .then(setShots)
      // 取失败就放开锁，下一次悬停还能再试；否则一次失败整个视频都没有预览。
      .catch(() => {
        shotsAsked.current = false
      })
  }

  /** 第 second 秒对应雪碧图里的哪一张、哪一格。索引是升序的，二分找最后一个不大于它的。 */
  const shotAt = (second: number): { image: string; col: number; row: number } | null => {
    if (!shots || shots.images.length === 0 || shots.index.length === 0) return null
    const per = Math.max(1, shots.columns * shots.rows)
    const total = Math.min(shots.index.length, shots.images.length * per)
    let lo = 0
    let hi = total - 1
    let best = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if ((shots.index[mid] ?? 0) <= second) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    const cell = best % per
    return {
      image: shots.images[Math.floor(best / per)] ?? '',
      col: cell % Math.max(1, shots.columns),
      row: Math.floor(cell / Math.max(1, shots.columns)),
    }
  }

  return (
    <>
    <div
      onMouseMove={poke}
      onMouseLeave={() => setControls(false)}
      onContextMenu={(event) => {
        const target = event.target
        if (target instanceof Element && target.closest('input, textarea')) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        setShotMenu({
          x: Math.min(event.clientX - box.left, Math.max(8, box.width - 180)),
          y: Math.min(event.clientY - box.top, Math.max(8, box.height - 300)),
        })
        poke()
      }}
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
        style={mirror ? { transform: 'scaleX(-1)' } : undefined}
        aria-label="视频画面"
      />
      <DanmakuField
        items={visibleDanmaku}
        position={() => Math.round(localPlayhead())}
        playing={playing}
        enabled={danmakuOn}
        opacity={danmakuOpacity}
        size={danmakuSize}
        speed={danmakuSpeed}
        area={danmakuArea}
        fade
      />
      {/* 字幕压在画面下缘、控制条之上；关掉字幕就整块不渲染。 */}
      {cue ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[9%] z-[3] flex justify-center px-10">
          <span
            className="max-w-[86%] rounded-[3px] bg-black/55 px-2 py-0.5 text-center leading-[1.45] text-white"
            style={{ fontSize: `${Math.max(13, danmakuSize + 3)}px`, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
          >
            {cue.text}
          </span>
        </div>
      ) : null}
      {cinema ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/55 to-transparent px-4 pb-12 pt-3">
          <div className="min-w-0 max-w-[72%]">
            <div className="truncate text-[14px] text-white/90" title={track.title}>
              {track.title}
            </div>
            {data.pages.length > 1 ? (
              <div className="mt-0.5 flex items-baseline gap-2 text-[12px] text-white/55">
                <span className="num shrink-0 text-white/80">P{currentPage}</span>
                <span className="truncate">{pageTitle || `第 ${currentPage} P`}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {!ready && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
          <BiliLoader label="正在取流…" />
        </div>
      ) : null}
      {ready && buffering && !ended && !error ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-white/85">
          <span className="bili-buffer-spin h-9 w-9 rounded-full border-2 border-white/25 border-t-white" />
          <span className="text-[12px]">正在缓冲…</span>
        </div>
      ) : null}
      {ready && !playing && !buffering && !ended && !error ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            togglePlay()
          }}
          aria-label="播放"
          className="t press absolute left-1/2 top-1/2 z-10 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/25 backdrop-blur-[2px] hover:bg-black/60"
        >
          <Icon name="play" size={24} />
        </button>
      ) : null}
      {error && !forceEnded ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center text-[13px] text-white">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              wantHeight.current = 0
              currentHeight.current = 0
              setError(null)
              setReady(false)
              setRetry((n) => n + 1)
            }}
            className="t press mt-1 rounded-full border border-white/30 px-3 py-1 text-[12px] text-white hover:border-white/70"
          >
            重试
          </button>
        </div>
      ) : null}

      {/* 播完的结束卡：B 站先给「即将播放」，三连与重播退到下一层。 */}
      {ended && (!error || forceEnded) ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-black/80 px-6 py-5 text-white backdrop-blur-[2px]">
          {nextUp ? (
            <div
              className="w-full max-w-[520px] text-left"
              onPointerEnter={() => {
                countdownHovered.current = true
                setCountdownHover(true)
              }}
              onPointerLeave={() => {
                countdownHovered.current = false
                setCountdownHover(false)
              }}
            >
              <div className="mb-2 flex items-center justify-between text-[12px] text-white/55">
                <span>即将播放</span>
                {autoplay && countdown !== null ? (
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex h-6 w-6 items-center justify-center">
                      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90" aria-hidden>
                        <circle
                          cx="12"
                          cy="12"
                          r="9"
                          fill="none"
                          stroke="rgba(255,255,255,0.16)"
                          strokeWidth="2"
                        />
                        <circle
                          cx="12"
                          cy="12"
                          r="9"
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="2"
                          pathLength={100}
                          strokeDasharray={100}
                          strokeDashoffset={100 - (countdown / 5) * 100}
                        />
                      </svg>
                      <span className="num text-[10px] text-white/80">{countdown}</span>
                    </span>
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={advance}
                className="t group flex w-full gap-3 rounded-[6px] border border-white/10 bg-white/[0.04] p-2 text-left hover:border-white/25 hover:bg-white/[0.08]"
              >
                <span className="relative aspect-video w-[168px] shrink-0 overflow-hidden rounded-[4px] bg-black">
                  {nextUp.cover ? (
                    <img
                      src={nextUp.cover}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">
                      <Icon name="play" size={18} />
                    </span>
                  </span>
                  {nextUp.durationMs ? (
                    <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/70 px-1 text-[10px] leading-4 text-white/85">
                      {formatTime(nextUp.durationMs)}
                    </span>
                  ) : null}
                  {nextUp.page ? (
                    <span className="num absolute left-1 top-1 rounded-[2px] bg-black/70 px-1 text-[10px] leading-4 text-white/85">
                      P{nextUp.page}
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="line-clamp-2 text-[14px] leading-5 text-white/90 group-hover:text-white">
                    {nextUp.title}
                  </span>
                  <span className="mt-1 block truncate text-[12px] text-white/50">
                    {nextUp.owner}
                    {nextUp.views !== null ? ` · ${formatCount(nextUp.views)} 播放` : ''}
                  </span>
                </span>
              </button>
              <div className="mt-2 flex items-center justify-between text-[12px]">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoplay}
                  aria-label="自动连播"
                  onClick={() => setAutoplay(!autoplay)}
                  className="t press flex items-center gap-1.5 text-white/55 hover:text-white"
                >
                  自动连播
                  <span
                    className={`relative flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
                      autoplay ? 'bg-[var(--accent)]' : 'bg-white/20'
                    }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                        autoplay ? 'translate-x-3' : 'translate-x-0'
                      }`}
                    />
                  </span>
                </button>
                {autoplay && countdown !== null ? (
                  <button
                    type="button"
                    onClick={() => setCountdownCancelled(true)}
                    className="t press rounded-[4px] px-1.5 py-0.5 text-white/55 hover:bg-white/10 hover:text-white"
                  >
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-white/65">播完了</div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[
              {
                on: liked,
                label: liked ? '已点赞' : '点赞',
                run: onLike,
                icon: <BiliThumb size={16} />,
              },
              {
                on: coins > 0,
                label: coins >= 2 ? '已投满' : '投币',
                run: onCoin,
                icon: <BiliCoin size={16} />,
                disabled: coins >= 2,
              },
              {
                on: faved,
                label: faved ? '已收藏' : '收藏',
                run: onFav,
                icon: <BiliStar size={16} />,
              },
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
            {nextTitle ? (
              <button
                type="button"
                onClick={advance}
                className="t press flex h-9 items-center gap-1.5 rounded-full border border-white/30 px-4 text-[13px] text-white hover:border-white/70"
              >
                <Icon name="play" size={14} />
                下一个
              </button>
            ) : null}
          </div>
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

      {shotMenu ? (
        <div
          data-shot-menu
          className="absolute z-40 min-w-[164px] overflow-hidden rounded-[6px] border border-white/15 bg-black/90 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur"
          style={{ left: shotMenu.x, top: shotMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setShotMenu(null)
              togglePlay()
            }}
            className="t flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            播放 / 暂停
            <span className="text-[11px] text-white/35">空格</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShotMenu(null)
              setLoopOne(!loopOne)
            }}
            className="t flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            循环播放
            <span className="text-[11px] text-white/35">{loopOne ? '✓' : ''}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShotMenu(null)
              setMirror(!mirror)
            }}
            className="t flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            镜像画面
            <span className="text-[11px] text-white/35">{mirror ? '✓' : ''}</span>
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              setShotMenu(null)
              setStageMode(!cinema, false)
            }}
            className="t flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            网页全屏
            <span className="text-[11px] text-white/35">W</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShotMenu(null)
              const full = cinema && osFullscreen
              setStageMode(!full, !full)
            }}
            className="t flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            全屏
            <span className="text-[11px] text-white/35">F</span>
          </button>
          <button
            type="button"
            onClick={captureShot}
            className="t flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            视频截图
            <span className="text-[11px] text-white/35" />
          </button>
          <button
            type="button"
            onClick={copyWatchLink}
            className="t flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            复制视频网址
          </button>
          <button
            type="button"
            onClick={copyCurrentTime}
            className="t flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            复制当前时间
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              setShotMenu(null)
              setStatsOn(!statsOn)
            }}
            className="t flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            视频统计信息
            <span className="text-[11px] text-white/35">{statsOn ? '✓' : ''}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShotMenu(null)
              setHelpOpen(true)
            }}
            className="t flex w-full items-center justify-between gap-6 border-t border-white/10 px-3 py-1.5 text-left text-[12px] text-white/90 hover:bg-white/15"
          >
            快捷键
            <span className="text-[11px] text-white/35">右键</span>
          </button>
        </div>
      ) : null}
      {statsOn && stats ? (
        <div className="pointer-events-none absolute left-3 top-3 z-30 rounded-[4px] bg-black/70 px-3 py-2 font-mono text-[11px] leading-[18px] text-white/90">
          <div>分辨率　{stats.width}×{stats.height}</div>
          <div>画质　　{data.qualities.find((q) => q.id === activeId)?.label ?? '—'}</div>
          <div>丢帧　　{stats.dropped}</div>
          <div>缓冲　　{stats.buffer.toFixed(1)} s</div>
          <div>倍速　　{stats.rate}×</div>
        </div>
      ) : null}
      <Modal
        open={helpOpen}
        title="播放器快捷键"
        description={null}
        onClose={() => setHelpOpen(false)}
        width="max-w-[420px]"
      >
        <dl className="text-[13px]">
          {[
            ['空格', '播放 / 暂停'],
            ['← / →', '后退 / 前进 5 秒'],
            ['↑ / ↓', '音量 ±5%'],
            ['M', '静音'],
            ['D', '弹幕开 / 关'],
            ['F', '全屏 / 退出'],
            ['W', '网页全屏 / 退出'],
            ['Esc', '退出全屏或收起右栏'],
            ['右键', '截图 / 快捷键'],
          ].map(([key, action]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 border-t border-hairline py-2 first:border-t-0"
            >
              <dt className="num shrink-0 rounded-[3px] border border-hairline bg-[var(--panel-raised)] px-1.5 py-0.5 text-[11px] text-[var(--text-2)]">
                {key}
              </dt>
              <dd className="text-right text-[var(--text-1)]">{action}</dd>
            </div>
          ))}
        </dl>
      </Modal>

      {/* 控制条浮在画面上：鼠标移上来才出现，静止就淡出。
          常驻一条控制条会把画面挤小，视频网站都不这么做。 */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-1.5 pt-10 text-white transition-opacity duration-200 ${
          controls || !playing ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* 全屏时没有画面下方那条栏，发弹幕留在控制条里。 */}
        {cinema ? (
          <div className="mb-1.5 flex items-center gap-2 lg:hidden">
            <DanmakuComposer
              tone="dark"
              signedIn={signedIn}
              onLogin={() => setAuthOpen(true)}
              value={draft}
              onChange={setDraft}
              onSend={() => void sendDanmaku()}
              sending={sending}
              inputClass="flex-1"
            />
          </div>
        ) : null}

        <div
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shownPercent)}
          tabIndex={0}
          // B 站可以按住进度条拖：拖的时候填充、时间、预览图跟着指针走，
          // 松手才真的落位。只做点击的话，拖到一半松手会跳到松手那一点，
          // 中间完全没有反馈。
          onPointerDown={(event) => {
            // 辅助功能直接 press 进度条时事件没有坐标，clientX 会是 0；
            // 那不是「拖到最左边」，交给方向键处理。
            if (event.button !== 0 || event.clientX <= 0 || !duration) return
            const box = event.currentTarget.getBoundingClientRect()
            // 指针在事件之间被松开时 capture 会抛，抓不住也不影响后续按坐标算比例。
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              /* 不影响拖动 */
            }
            const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
            setScrub(ratio)
            setHoverAt({ ratio, second: Math.round((ratio * duration) / 1000), width: box.width })
            askShots()
          }}
          onPointerUp={(event) => {
            if (event.button !== 0 || event.clientX <= 0 || !duration) return
            const box = event.currentTarget.getBoundingClientRect()
            const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
            setScrub(null)
            seekTo(ratio)
            setHoverAt({ ratio, second: Math.round((ratio * duration) / 1000), width: box.width })
          }}
          onPointerCancel={() => setScrub(null)}
          // 标成 slider 就必须能被键盘操作：Home/End 跳到两端，
          // 方向键按 5 秒走。缺这一段，读屏和纯键盘用户完全拖不动进度。
          onKeyDown={(event) => {
            if (!duration) return
            const step = event.shiftKey ? 30_000 : 5_000
            const at = localPlayhead()
            const keys: Record<string, number | undefined> = {
              Home: 0,
              // 正好落在 duration 上会被解码器当成越界忽略，留 1.5 秒。
              End: Math.max(0, 1 - 1500 / duration),
              ArrowLeft: (at - step) / duration,
              ArrowDown: (at - step) / duration,
              ArrowRight: (at + step) / duration,
              ArrowUp: (at + step) / duration,
            }
            const target = keys[event.key]
            if (target === undefined) return
            event.preventDefault()
            seekTo(target)
          }}
          onMouseEnter={askShots}
          onPointerMove={(event) => {
            if (!duration) return
            const box = event.currentTarget.getBoundingClientRect()
            const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
            setHoverAt({ ratio, second: Math.round((ratio * duration) / 1000), width: box.width })
            if (scrub !== null) setScrub(ratio)
          }}
          onMouseLeave={() => setHoverAt(null)}
          className="bili-progress group relative mb-1.5 h-3 cursor-pointer touch-none"
        >
          <DanmakuBeats
            items={visibleDanmaku}
            durationMs={duration}
            onSeek={(ms) => {
              if (!duration) return
              seekTo(ms / duration)
            }}
          />
          {hoverAt ? (
            (() => {
              const shot = shotAt(hoverAt.second)
              if (!shot) {
                // 缩略图还没到（或这条视频没有图）时，至少把落点时间给出来。
                return (
                  <span
                    className="num pointer-events-none absolute bottom-full z-30 mb-1 -translate-x-1/2 whitespace-nowrap rounded-[3px] bg-black/75 px-1.5 py-0.5 text-[11px] leading-4 text-white"
                    style={{ left: `${Math.min(96, Math.max(4, hoverAt.ratio * 100))}%` }}
                  >
                    {formatTime(hoverAt.second * 1000)}
                  </span>
                )
              }
              return (
                <span
                  className="pointer-events-none absolute bottom-full z-30 mb-2 block h-[90px] w-[160px] -translate-x-1/2 overflow-hidden rounded-[4px] border border-white/25 bg-black shadow-[0_6px_20px_rgba(0,0,0,0.55)]"
                  style={{
                    left: Math.min(
                      Math.max(hoverAt.ratio * hoverAt.width, 80),
                      Math.max(80, hoverAt.width - 80),
                    ),
                  }}
                >
                  {/* 雪碧图用 img 而不是 background-image：图片 CDN 对 tauri://localhost
                      这个 Referer 回 403，只有 referrerPolicy 才能把它去掉。 */}
                  <img
                    src={shot.image}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="absolute max-w-none"
                    style={{
                      width: 160 * (shots?.columns ?? 1),
                      height: 90 * (shots?.rows ?? 1),
                      left: -shot.col * 160,
                      top: -shot.row * 90,
                    }}
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1.5 py-0.5 text-[11px] leading-4 text-white">
                    <span className="num text-white/70">{formatTime(hoverAt.second * 1000)} </span>
                    <span className="line-clamp-1">{chapterAt(hoverAt.second * 1000)?.title}</span>
                  </span>
                </span>
              )
            })()
          ) : null}
          <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-white/25" />
          {chapters.map((chapter) => (
            <span
              key={chapter.at}
              role="img"
              aria-label={chapter.title || formatTime(chapter.at)}
              title={chapter.title || formatTime(chapter.at)}
              className="pointer-events-none absolute top-1/2 h-[9px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85 shadow-[0_0_3px_rgba(0,0,0,0.6)]"
              style={{ left: `${Math.min(100, (chapter.at / Math.max(1, duration)) * 100)}%` }}
            />
          ))}
          <span
            /* 主题只有一种强调色，进度条也用它。 */
            className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--accent)]"
            style={{ width: `${shownPercent}%` }}
          />
          <span
            className={`pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
              scrub === null ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ left: `${shownPercent}%` }}
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
            {formatTime(scrub === null ? now : scrub * duration)}
            <span className="hidden sm:inline"> / {formatTime(duration)}</span>
          </span>

          <div className="min-w-0 flex-1" />

          {cinema ? (
            <div className="hidden items-center gap-2 lg:flex">
              <DanmakuComposer
                tone="dark"
                signedIn={signedIn}
                onLogin={() => setAuthOpen(true)}
                value={draft}
                onChange={setDraft}
                onSend={() => void sendDanmaku()}
                sending={sending}
                inputClass="w-[150px] shrink-0"
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={captureShot}
            aria-label="截图"
            title="截图"
            className="bili-icon-btn t press flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white/85 hover:bg-white/15"
          >
            <Icon name="camera" size={16} />
          </button>

          <button
            type="button"
            aria-pressed={danmakuOn}
            aria-label={danmakuOn ? '关闭弹幕' : '打开弹幕'}
            title={danmakuOn ? '关闭弹幕' : '打开弹幕'}
            onClick={() => setDanmakuEnabled(!danmakuOn)}
            className={`t press flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] ${
              danmakuOn ? 'bg-white/20 text-white' : 'text-white/45 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            <BiliDanmakuSwitch size={18} on={danmakuOn} />
          </button>

          {/* 字幕。没有字幕轨的条目不出现这颗按钮——B 站也是这样。 */}
          {subtitleTracks.length > 0 ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDanmakuPanel(false)
                  setQualityOpen(false)
                  setSpeedOpen(false)
                  setSubMenu((open) => !open)
                }}
                aria-expanded={subMenu}
                aria-label="字幕"
                title="字幕"
                className={`bili-icon-btn t press flex h-7 shrink-0 items-center justify-center rounded-[4px] px-1.5 text-[11px] font-medium tracking-wide ${
                  subTrack ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/15'
                }`}
              >
                CC
              </button>
              {subMenu ? (
                <div className="absolute bottom-9 right-0 z-30 flex max-h-[260px] w-[168px] flex-col overflow-y-auto rounded-[6px] border border-white/15 bg-black/90 py-1 backdrop-blur">
                  <button
                    type="button"
                    onClick={() => {
                      setSubTrack(null)
                      setSubMenu(false)
                    }}
                    className={`t press px-3 py-1 text-left text-[12px] ${
                      subTrack === null ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/10'
                    }`}
                  >
                    关闭字幕
                  </button>
                  {subtitleTracks.map((t) => (
                    <button
                      key={t.lan}
                      type="button"
                      onClick={() => {
                        setSubTrack(t.lan)
                        setSubMenu(false)
                      }}
                      className={`t press px-3 py-1 text-left text-[12px] ${
                        subTrack === t.lan ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/10'
                      }`}
                    >
                      {t.label || t.lan}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 弹幕设置。B 站播放器在「弹」旁边就是这个齿轮：显示区域、样式、颜色、位置都在这里。 */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setQualityOpen(false)
                setSpeedOpen(false)
                setPagesOpen(false)
                setDanmakuPanel((open) => !open)
              }}
              aria-expanded={danmakuPanel}
              aria-label="弹幕设置"
              title="弹幕设置"
              className={`bili-icon-btn t press flex h-7 w-7 items-center justify-center rounded-[4px] ${
                danmakuPanel ? 'text-[var(--accent)]' : 'text-white/85 hover:bg-white/15'
              }`}
            >
              <BiliDanmakuSetting size={17} />
            </button>
            {danmakuPanel ? (
              <div className="absolute bottom-9 right-0 z-30 max-h-[70vh] w-[236px] overflow-y-auto rounded-[6px] border border-white/15 bg-black/90 p-3 text-white backdrop-blur">
                <div className="flex items-center justify-between text-[11px] leading-none text-white/70">
                  <span>显示区域</span>
                  <span>{DANMAKU_AREAS.find((option) => option.value === danmakuArea)?.name}</span>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {DANMAKU_AREAS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={danmakuArea === option.value}
                      onClick={() => patchDanmaku({ area: option.value })}
                      className={`t press flex-1 rounded-[3px] py-1 text-[11px] leading-none ${
                        danmakuArea === option.value
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-white/10 text-white/80 hover:bg-white/20'
                      }`}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
                {(
                  [
                    { key: 'opacity', label: '不透明度', min: 0.2, max: 1, step: 0.1, value: danmakuOpacity },
                    { key: 'size', label: '字号', min: 11, max: 20, step: 1, value: danmakuSize },
                    { key: 'speed', label: '速度', min: 0.6, max: 2, step: 0.2, value: danmakuSpeed },
                  ] as const
                ).map((row) => (
                  <label key={row.key} className="block border-t border-white/10 pt-2">
                    <span className="flex items-center justify-between text-[11px] leading-none text-white/70">
                      <span>{row.label}</span>
                      <span className="num">{row.key === 'opacity' ? `${Math.round(row.value * 100)}%` : row.value}</span>
                    </span>
                    <input
                      type="range"
                      min={row.min}
                      max={row.max}
                      step={row.step}
                      value={row.value}
                      onChange={(event) => patchDanmaku({ [row.key]: Number(event.target.value) })}
                      className="bili-range mt-1 w-full"
                    />
                  </label>
                ))}

                <div className="border-t border-white/10 pt-2">
                  <div className="flex items-center justify-between text-[11px] leading-none text-white/70">
                    <span>屏蔽类型</span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {(
                      [
                        { value: 'roll', name: '滚动' },
                        { value: 'top', name: '顶部' },
                        { value: 'bottom', name: '底部' },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={danmakuBlockTypes.includes(option.value)}
                        onClick={() => toggleDanmakuBlockType(option.value)}
                        className={`t press flex-1 rounded-[4px] py-1 text-[11px] leading-none ${
                          danmakuBlockTypes.includes(option.value)
                            ? 'bg-[var(--accent)] text-white'
                            : 'bg-white/10 text-white/80 hover:bg-white/20'
                        }`}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/10 pt-2">
                  <div className="flex items-center justify-between text-[11px] leading-none text-white/70">
                    <span>屏蔽词</span>
                    {danmakuBlockWords.length > 0 ? (
                      <span className="num">{danmakuBlockWords.length} 个</span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <input
                      value={blockDraft}
                      onChange={(event) => setBlockDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          addBlockWords()
                        }
                      }}
                      placeholder="输入后回车"
                      className="h-6 min-w-0 flex-1 rounded-[3px] border border-white/15 bg-white/[0.08] px-1.5 text-[11px] text-white placeholder-white/45 outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={addBlockWords}
                      className="t press h-6 rounded-[3px] bg-white/10 px-2 text-[11px] text-white/80 hover:bg-white/20"
                    >
                      加
                    </button>
                  </div>
                  {danmakuBlockWords.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {danmakuBlockWords.map((word) => (
                        <button
                          key={word}
                          type="button"
                          onClick={() =>
                            setDanmakuBlockWords(danmakuBlockWords.filter((item) => item !== word))
                          }
                          className="t press rounded-[3px] bg-white/10 px-1.5 py-0.5 text-[10px] text-white/75 hover:bg-white/20"
                        >
                          {word} ×
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-white/10 pt-2">
                  <div className="flex items-center justify-between text-[11px] leading-none text-white/70">
                    <span>弹幕颜色</span>
                    <span>{DANMAKU_COLORS.find((color) => color.value === sendColor)?.name}</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-8 gap-1.5">
                    {DANMAKU_COLORS.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        aria-label={`弹幕颜色 ${color.name}`}
                        aria-pressed={sendColor === color.value}
                        onClick={() => setSendColor(color.value)}
                        className={`h-4 w-4 rounded-full border ${
                          sendColor === color.value ? 'border-white ring-1 ring-white' : 'border-white/40'
                        }`}
                        style={{ background: cssColor(color.value) }}
                      />
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/10 pt-2">
                  <div className="flex items-center justify-between text-[11px] leading-none text-white/70">
                    <span>位置</span>
                    <span>{DANMAKU_MODES.find((mode) => mode.value === draftMode)?.name}</span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {DANMAKU_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        aria-pressed={draftMode === mode.value}
                        onClick={() => setDraftMode(mode.value)}
                        className={`t press flex-1 rounded-[4px] py-1 text-[11px] leading-none ${
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
              </div>
            ) : null}
          </div>

          {data.pages.length > 1 ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDanmakuPanel(false)
                  setSpeedOpen(false)
                  setQualityOpen(false)
                  setPagesOpen((open) => !open)
                }}
                aria-expanded={pagesOpen}
                aria-label="选集"
                title="选集"
                className="t press flex h-7 items-center gap-1 rounded-[4px] px-2 text-[12px] hover:bg-white/15"
              >
                选集
                <span className="num text-[11px] text-white/55">P{currentPage}</span>
              </button>
              {pagesOpen ? (
                <div className="absolute bottom-8 right-0 z-30 flex max-h-[320px] w-[280px] flex-col overflow-y-auto rounded-[6px] border border-white/15 bg-black/90 py-1 backdrop-blur">
                  {data.pages.map((page) => {
                    const on = page.no === currentPage
                    return (
                      <button
                        key={page.cid}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          onPage(page.no)
                          setPagesOpen(false)
                        }}
                        className={`t flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px] ${
                          on
                            ? 'bg-white/10 text-[var(--accent)]'
                            : 'text-white/85 hover:bg-white/10'
                        }`}
                      >
                        <span className="num shrink-0">P{page.no}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {page.title || `第 ${page.no} P`}
                        </span>
                        {page.duration_ms ? (
                          <span className="num shrink-0 text-[11px] text-white/45">
                            {formatTime(page.duration_ms)}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {data.qualities.length > 0 ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDanmakuPanel(false)
                  setSpeedOpen(false)
                  setPagesOpen(false)
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

          <button
            type="button"
            aria-pressed={loopOne}
            aria-label={loopOne ? '关闭单集循环' : '单集循环'}
            title={loopOne ? '关闭单集循环' : '单集循环'}
            onClick={() => setLoopOne(!loopOne)}
            className={`bili-icon-btn t press flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] ${
              loopOne ? 'bg-white/20 text-[var(--accent)]' : 'text-white/85 hover:bg-white/15'
            }`}
          >
            <Icon name="repeatOne" size={16} />
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setDanmakuPanel(false)
                setQualityOpen(false)
                setPagesOpen(false)
                setSpeedOpen((open) => !open)
              }}
              aria-expanded={speedOpen}
              title="播放倍速"
              aria-label={`播放倍速 ${speed}x`}
              className={`t press num flex h-7 items-center rounded-[4px] px-2 text-[12px] ${
                speedOpen ? 'text-[var(--accent)]' : 'hover:bg-white/15'
              }`}
            >
              {speed}x
            </button>
            {speedOpen ? (
              <div className="absolute bottom-8 right-0 z-30 flex w-[84px] flex-col rounded-[6px] border border-white/15 bg-black/90 py-1 text-white backdrop-blur">
                {[...SPEEDS].reverse().map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      void setSpeed(rate)
                      setSpeedOpen(false)
                    }}
                    className={`t press px-3 py-1 text-left text-[12px] ${
                      rate === speed
                        ? 'text-[var(--accent)]'
                        : 'text-white/85 hover:bg-white/10'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* 音量在窄屏交给系统；倍速是播放器状态，任何宽度都得留着。 */}
          <span
            className="hidden shrink-0 items-center xl:flex"
            style={{ ['--text-2' as string]: 'rgb(255 255 255 / 0.85)' }}
          >
            <VolumeControl />
          </span>

          {/* B 站播放器在这两个位置摆的是「网页全屏」和「全屏」。
              桌面端也保留这个层次：前者只铺满窗口，后者再进系统全屏。 */}
          <button
            type="button"
            onClick={() => setStageMode(!cinema, false)}
            aria-label={cinema && !osFullscreen ? '退出网页全屏' : '网页全屏'}
            title="网页全屏（W）"
            className={`bili-icon-btn t press hidden h-[22px] w-9 shrink-0 items-center justify-center rounded-[4px] lg:flex ${
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
    {!cinema ? (
      <div className="flex items-center gap-2 border-b border-hairline bg-[var(--panel-alt)] px-3 py-2">
        {online !== null && online > 0 ? (
          <span className="num flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)]">
            <Icon name="user" size={13} />
            {formatCount(online)} 人在看
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DanmakuComposer
            tone="light"
            signedIn={signedIn}
            onLogin={() => setAuthOpen(true)}
            value={draft}
            onChange={setDraft}
            onSend={() => void sendDanmaku()}
            sending={sending}
            inputClass="flex-1"
          />
        </div>
      </div>
    ) : null}
    </>
  )
}
