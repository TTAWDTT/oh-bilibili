import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount, formatDate, formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { copyText } from '../../shared/lib/clipboard'
import { toastDone, toastFailure } from '../../app/notice'
import { useReactionStore } from '../reactions/reactionStore'
import { useDownloadsStore } from '../downloads/downloadsStore'
import { AnchoredPanel } from '../../shared/ui/AnchoredPanel'
import { Icon } from '../../shared/ui/Icon'
import { parseSources } from './sources'
import { SourceLinks } from './SourceLinks'

/** 简介展开状态按 BV 记住：从素材里的站内作品返回，简介仍是展开的。 */
const descOpenMemory = new Map<string, boolean>()
import { Modal } from '../../shared/ui/Modal'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'
import { SharePanel } from './SharePanel'
import { SummaryCard } from './SummaryCard'
import { watchUrl } from './watchUrl'
import './watch-details.css'

const TRIPLE_HOLD_MS = 550

function ReactionGlyph({
  kind, holding, burst, children,
}: {
  kind: 'like' | 'coin' | 'favorite'
  holding: boolean
  burst: number
  children: React.ReactNode
}) {
  return (
    <span className={`bili-tri-glyph bili-tri-${kind}`}>
      {holding ? (
        <svg aria-hidden className="bili-tri-charge" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="16" pathLength="1" />
        </svg>
      ) : null}
      <span key={burst} className={burst ? 'bili-tri-celebrate' : 'inline-flex'}>
        {children}
      </span>
    </span>
  )
}

/** 简介里的链接单独成段；长 URL 可以断行，点开走系统浏览器。 */
/** `01:23` / `1:02:03` 转毫秒。B 站简介里的时间戳点一下就跳到那一刻。 */
function timestampMs(token: string): number | null {
  const parts = token.split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 2) return ((parts[0] ?? 0) * 60 + (parts[1] ?? 0)) * 1000
  if (parts.length === 3) {
    return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * 1000
  }
  return null
}

function descriptionNodes(text: string, onSeek: (ms: number) => void): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+|\b(?:\d{1,2}:)?[0-5]?\d:[0-5]\d\b)/g).map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      const url = part.replace(/[.,;:!?，。；、）…]+$/, '')
      return (
        <button
          key={index}
          type="button"
          onClick={() => void ipc.openExternal(url).catch((cause) => toastFailure('打开链接', cause))}
          className="t break-all text-left text-[var(--accent)] hover:underline"
        >
          {url}
        </button>
      )
    }
    const at = timestampMs(part)
    if (at === null) return part
    return (
      <button
        key={index}
        type="button"
        onClick={() => onSeek(at)}
        className="t text-[var(--accent)] hover:underline"
      >
        {part}
      </button>
    )
  })
}

/**
 * 播放器上方的标题与统计行。
 *
 * B 站网页端的顺序是「标题 → 播放量/弹幕/日期 → 播放器 → 三连」，
 * 标题在画面之上，先知道在放什么，再决定看不看。之前标题压在播放器下面，
 * 一屏里画面占满，标题要往下才看得到。
 */
export function WatchHead({
  track,
  data,
  currentPage,
  onListen,
}: {
  track: Track
  data: WatchData
  currentPage: number
  onListen: (atMs: number) => void
}) {
  const page = data.pages.find((entry) => entry.no === currentPage)
  return (
    <div className="watch-head">
      {/* 返回键在画面左上角；这里只留标题与「听视频」。 */}
      <div className="flex items-start gap-2">
        <h1
          className="min-w-0 flex-1 text-[20px] leading-[1.32] font-semibold md:text-[24px] text-[var(--text-1)]"
          title={track.title}
        >
          {track.title}
        </h1>
        <button
          type="button"
          onClick={() => onListen(Math.round(readPlayhead()))}
          className="t press mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-2 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--accent)]"
        >
          <Icon name="headphones" size={14} /> 听视频
        </button>
      </div>

      {data.pages.length > 1 && page ? (
        <div className="mt-1 flex min-w-0 items-baseline gap-2 text-[13px] text-[var(--text-2)]">
          <span className="num shrink-0 rounded-[3px] bg-[var(--accent-soft)] px-1.5 leading-[20px] text-[var(--accent)]">
            P{currentPage}
          </span>
          <span className="truncate" title={page.title}>
            {page.title || `第 ${currentPage} P`}
          </span>
        </div>
      ) : null}

      <div className="watch-head-stats">
        <span className="num"><Icon name="play" size={13} />{formatCount(data.stats.views)} 播放</span>
        <span className="num"><Icon name="danmaku" size={14} />{formatCount(data.stats.danmaku)} 弹幕</span>
        <button
          type="button"
          onClick={() =>
            document
              .getElementById('watch-comments')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          className="num t hover:text-[var(--accent)]"
        >
          {formatCount(data.stats.replies)} 评论
        </button>
        {/* B 站这一行的尾巴是投稿日期，分区名跟在后面。 */}
        {data.pubdate > 0 ? <span className="num">{formatDate(data.pubdate)}</span> : null}
        {data.tname ? (
          <span className="rounded-[3px] bg-[var(--panel-raised)] px-1.5 leading-[18px] text-[var(--text-2)]">
            {data.tname}
          </span>
        ) : null}
        {/* B 站视频页在统计行尾巴挂着 BV 号，点一下就是分享链接。 */}
        <button
          type="button"
          title="复制 BV 号与链接"
          onClick={() => {
            void copyText(watchUrl(track.key, currentPage)).then((ok) =>
              toastDone(ok ? `已复制 ${track.key}` : '复制失败'),
            )
          }}
          className="num rounded-[3px] px-1.5 leading-[18px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
        >
          {track.key}
        </button>
      </div>

    </div>
  )
}

/**
 * 观看页的信息与互动：UP 主、关注、计数、三连、稍后再看、简介、分P。
 *
 * 每个按钮都复述服务端的真实状态：点赞/收藏/投币来自 reaction store 的
 * 一次批量刷新，关注与稍后再看在这里各自读一次，读不到就不显示或标成未点。
 */
export function WatchInfo({
  track,
  data,
  currentPage,
  likeDelta,
  favDelta,
  coinDelta,
  onLike,
  onFav,
  onCoin,
  onTriple,
  burst,
  onSeek,
  ownerRow,
}: {
  track: Track
  data: WatchData
  currentPage: number
  /** 点赞与收藏的计数偏移由观看页统一持有，这里只负责显示。 */
  likeDelta: number
  favDelta: number
  coinDelta: number
  onLike: () => Promise<boolean | null>
  onFav: () => void
  onCoin: (count: number, alsoLike: boolean) => void
  /** 长按点赞：B 站的一键三连。 */
  onTriple: () => void
  burst: number
  /** 简介里的时间戳跳转。 */
  onSeek: (ms: number) => void
  /** 窄屏主栏的 UP 主行；宽屏只在右栏放名片。 */
  ownerRow?: React.ReactNode
}) {
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const cid = data.pages.find((page) => page.no === data.current_page)?.cid ?? data.pages[0]?.cid ?? 0

  const [saved, setSaved] = useState(false)
  /** 视频标签。公开接口，取不到就不显示这一行。 */
  const [tags, setTags] = useState<string[]>([])
  /** 简介默认收两行，长简介给一个展开。 */
  const [descOpen, setDescOpen] = useState(() => descOpenMemory.get(track.key) ?? false)
  const [descCanExpand, setDescCanExpand] = useState(false)
  const descRef = useRef<HTMLParagraphElement | null>(null)
  const sources = parseSources(data.desc, data.key)

  // 换了稿件才重置；从出处返回同一稿时沿用这次会话里记下的展开状态。
  useEffect(() => {
    setDescOpen(descOpenMemory.get(track.key) ?? false)
  }, [track.key])

  useEffect(() => {
    const el = descRef.current
    if (!el) return
    const measure = (): void => {
      const clone = el.cloneNode(true) as HTMLElement
      clone.classList.remove('line-clamp-2')
      clone.style.position = 'absolute'
      clone.style.visibility = 'hidden'
      clone.style.left = '-9999px'
      clone.style.top = '0'
      clone.style.width = `${el.clientWidth}px`
      clone.style.display = 'block'
      clone.style.webkitLineClamp = 'unset'
      document.body.appendChild(clone)
      const full = clone.scrollHeight
      clone.remove()
      // 收着的时候 el 只剩两行；展开之后要拿全文高度和两行比，按钮才不会消失。
      const twoLines = (Number.parseFloat(getComputedStyle(el).lineHeight) || 20) * 2
      setDescCanExpand(full > twoLines + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [data.desc, descOpen])
  /** 投币面板锚定到触发按钮。 */
  const [coinAt, setCoinAt] = useState<{ left: number; top: number; anchorTop: number } | null>(null)
  const [shareAt, setShareAt] = useState<{ left: number; top: number; anchorTop: number } | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const downloadKey = currentPage > 1 ? `${track.key}_p${currentPage}` : track.key
  const downloadPending = useDownloadsStore((state) => state.pending.has(downloadKey))
  const download = useDownloadsStore((state) =>
    state.items?.find((entry) => entry.key === downloadKey),
  )
  const enqueueDownload = useDownloadsStore((state) => state.enqueue)
  const downloading = downloadPending || download?.state === 'queued' || download?.state === 'running'
  const downloaded = download?.state === 'done'
  const [coinPick, setCoinPick] = useState(1)
  const [alsoLike, setAlsoLike] = useState(true)
  /** 长按点赞：按住 550ms 触发一键三连。松手就算普通点赞。 */
  const [holding, setHolding] = useState(false)
  const holdTimer = useRef<number | null>(null)
  const skipPointerClick = useRef(false)
  /** 详情里的投币数是打开那一刻的快照，自己投出去的要自己加上。 */
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)

  useEffect(() => {
    let cancelled = false
    setSaved(false)
    setTags([])
    setCoinAt(null)
    setShareAt(null)
    void ipc
      .watchLaterList()
      .then((list) => {
        if (!cancelled) setSaved(list.some((t) => t.key === track.key))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track.key])

  useEffect(() => {
    let cancelled = false
    void ipc
      .videoTags(track.key)
      .then((list) => {
        if (!cancelled) setTags(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track.key])

  useEffect(() => {
    setHolding(false)
    const cancel = (): void => {
      if (holdTimer.current === null) return
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
      skipPointerClick.current = true
      setHolding(false)
    }
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
      holdTimer.current = null
      skipPointerClick.current = true
    }
  }, [track.key])

  useEffect(() => {
    if (!noteOpen) return
    const timer = window.setTimeout(() => noteRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [noteOpen])

  const openCoin = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (coins >= 2) {
      toastDone('已经投过两枚', 'B 站上限 2 枚')
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setCoinAt({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 276)),
      top: rect.bottom + 8,
      anchorTop: rect.top,
    })
    setCoinPick(1)
    setAlsoLike(!liked)
  }

  const tapLike = async (button: HTMLButtonElement): Promise<void> => {
    const next = await onLike()
    if (!next || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    button.querySelector('.bili-tri-like')?.animate(
      [
        { transform: 'none' },
        { transform: 'translateY(-2px) scale(1.13) rotate(-5deg)', offset: 0.4 },
        { transform: 'none' },
      ],
      { id: 'watch-like-tap', duration: 260, easing: 'ease-out' },
    )
  }

  const startHold = (): void => {
    skipPointerClick.current = false
    setHolding(true)
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      skipPointerClick.current = true
      setHolding(false)
      onTriple()
    }, TRIPLE_HOLD_MS)
  }

  const endHold = (cancelled = false): void => {
    if (holdTimer.current === null) return
    window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    skipPointerClick.current = cancelled
    setHolding(false)
  }

  const noteKey = `oh-bilibili:watch-note:${track.key}`
  const noteTimes = [...new Set(note.match(/\[((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)\]/g) ?? [])]
    .map((token) => token.slice(1, -1))
    .map((label) => ({ label, at: timestampMs(label) }))
    .filter((item): item is { label: string; at: number } => item.at !== null)
  const openNote = (): void => {
    try {
      setNote(localStorage.getItem(noteKey) ?? '')
    } catch {
      setNote('')
    }
    setNoteOpen(true)
  }
  const insertNoteTime = (): void => {
    const stamp = `[${formatTime(readPlayhead())}] `
    const el = noteRef.current
    const start = el?.selectionStart ?? note.length
    const end = el?.selectionEnd ?? start
    const next = note.slice(0, start) + stamp + note.slice(end)
    setNote(next)
    window.requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + stamp.length, start + stamp.length)
    })
  }
  const saveNote = (): void => {
    try {
      if (note.trim()) localStorage.setItem(noteKey, note)
      else localStorage.removeItem(noteKey)
      setNoteOpen(false)
      toastDone(note.trim() ? '笔记已保存' : '笔记已清空')
    } catch {
      toastFailure('保存笔记', new Error('本地存储不可用'))
    }
  }

  /**
   * 操作项。B 站网页版的工具栏没有边框：图标 + 数字平铺一排，悬停才给一层浅底。
   * 做成胶囊会让这一行看起来像一排按钮，而 B 站把它当成视频信息的附注。
   */
  const action = (on: boolean): string =>
    [
      'bili-icon-btn t press inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px]',
      on
        ? 'text-[var(--accent)]'
        : 'text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--text-1)]',
    ].join(' ')

  return (
    <div className="watch-details">
      <div
        data-watch-actions
        className="watch-actions"
        style={{ '--hold-duration': `${TRIPLE_HOLD_MS}ms` } as React.CSSProperties}
      >
        <button
          type="button"
          aria-pressed={liked}
          aria-label={liked ? '取消点赞' : '点赞'}
          aria-description="长按点赞或按住空格键、回车键可一键三连"
          onPointerDown={(event) => { if (event.button === 0) startHold() }}
          onPointerUp={() => endHold()}
          onPointerLeave={() => endHold(true)}
          onPointerCancel={() => endHold(true)}
          onBlur={() => endHold(true)}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            if (!event.repeat) startHold()
          }}
          onKeyUp={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            if (holdTimer.current === null) return
            endHold()
            void tapLike(event.currentTarget)
          }}
          onClick={(event) => {
            if (!skipPointerClick.current || event.detail === 0) void tapLike(event.currentTarget)
          }}
          className={`${action(liked)} bili-tri-btn`}
          title={liked ? '取消点赞（长按一键三连）' : '点赞（长按一键三连）'}
        >
          <ReactionGlyph kind="like" holding={holding} burst={burst}>
            <BiliThumb size={26} filled={liked} />
          </ReactionGlyph>
          {formatCount(Math.max(0, data.stats.likes + likeDelta))}
        </button>
        <button
          type="button"
          aria-pressed={coins > 0}
          aria-label="投币"
          onClick={openCoin}
          className={`${action(coins > 0)} bili-tri-btn`}
          title="投币"
        >
          <ReactionGlyph kind="coin" holding={holding} burst={burst}>
            <BiliCoin size={24} />
          </ReactionGlyph>
          {formatCount(data.stats.coins + coinDelta)}
        </button>
        <button
          type="button"
          aria-pressed={faved}
          aria-label={faved ? '取消收藏' : '收藏'}
          onClick={onFav}
          className={`${action(faved)} bili-tri-btn`}
          title={faved ? '取消收藏（E）' : '收藏（E）'}
        >
          <ReactionGlyph kind="favorite" holding={holding} burst={burst}>
            <BiliStar size={24} filled={faved} />
          </ReactionGlyph>
          {formatCount(Math.max(0, data.stats.favorites + favDelta))}
        </button>
        <button
          type="button"
          title="分享"
          aria-label="分享"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setShareAt({
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 536)),
              top: rect.bottom + 8,
              anchorTop: rect.top,
            })
          }}
          className={action(false)}
        >
          <Icon name="share" size={22} />
          {formatCount(data.stats.shares)}
        </button>
        <button type="button" aria-label="视频笔记" onClick={openNote} className={`${action(false)} watch-personal watch-tools-start`}>
          <Icon name="note" size={20} />
          笔记
        </button>
        <button
          type="button"
          aria-pressed={downloaded}
          onClick={() => {
            if (downloading || downloaded) return
            void enqueueDownload(downloadKey)
          }}
          className={`${action(downloaded)} watch-personal`}
        >
          <Icon name={downloaded ? 'check' : downloading ? 'clock' : 'download'} size={20} />
          {downloaded ? '已下载' : downloading ? '下载中' : '下载'}
        </button>
        <button
          type="button"
          aria-pressed={saved}
          onClick={() => {
            const next = !saved
            void ipc
              .watchLaterSet(track.key, next)
              .then(() => {
                setSaved(next)
                toastDone(next ? '已加入稍后再看' : '已从稍后再看移除')
              })
              .catch(() =>
                toastDone(next ? '加入稍后再看失败' : '移出稍后再看失败', '登录后再试'),
              )
          }}
          className={`${action(saved)} watch-personal`}
        >
          <Icon name="watchLater" size={20} />
          {saved ? '已加入' : '稍后再看'}
        </button>
      </div>
      <AnchoredPanel anchor={coinAt} onClose={() => setCoinAt(null)} label="投币">
        <div className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--text-2)]">给 UP 主投上硬币</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setCoinAt(null)}
                className="t text-[var(--text-3)] hover:text-[var(--text-1)]"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              {Array.from({ length: Math.max(0, 2 - coins) }, (_, index) => index + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={coinPick === n}
                  onClick={() => setCoinPick(n)}
                  className={`t flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-[6px] border text-[13px] ${
                    coinPick === n
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--line)] text-[var(--text-2)] hover:border-[var(--accent)]'
                  }`}
                >
                  <BiliCoin size={18} filled={coinPick === n} />
                  {n} 枚
                </button>
              ))}
            </div>
            {!liked ? (
              <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--text-2)]">
                <input
                  type="checkbox"
                  checked={alsoLike}
                  onChange={(event) => setAlsoLike(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                同时点赞
              </label>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCoinAt(null)
                  onCoin(coinPick, alsoLike)
                }}
                className="t press h-8 flex-1 rounded-[4px] bg-[var(--accent)] text-[13px] text-white hover:opacity-90"
              >
                投 {coinPick} 枚
              </button>
              <button
                type="button"
                onClick={() => setCoinAt(null)}
                className="t shrink-0 px-2 text-[13px] text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                下次一定
              </button>
            </div>
        </div>
      </AnchoredPanel>
      <AnchoredPanel anchor={shareAt} onClose={() => setShareAt(null)} label="分享" width={520}>
        <SharePanel track={track} page={data.current_page} onClose={() => setShareAt(null)} />
      </AnchoredPanel>
      <Modal
        open={noteOpen}
        title="视频笔记"
        description={null}
        onClose={() => setNoteOpen(false)}
        width="max-w-[620px]"
      >
        <textarea
          ref={noteRef}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={10}
          aria-label="视频笔记"
          placeholder="点「插入当前时间」，把想法和播放位置一起记下来"
          className="w-full resize-y rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] leading-[1.6] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
        />
        {noteTimes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {noteTimes.map(({ label, at }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setNoteOpen(false)
                  onSeek(at)
                }}
                className="t press rounded-[4px] bg-[var(--accent-soft)] px-2 py-0.5 text-[12px] text-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_18%,white)]"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={insertNoteTime}
            className="t press text-[12px] text-[var(--accent)] hover:underline"
          >
            插入当前时间
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNoteOpen(false)}
              className="t press rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-3)] hover:bg-[var(--panel-alt)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveNote}
              className="t press rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-[13px] text-white hover:opacity-90"
            >
              保存
            </button>
          </div>
        </div>
      </Modal>

      {/* B 站宽屏只在右栏放 UP 名片；窄屏没有右栏，这里补一行。 */}
      {ownerRow}

      {data.desc ? (
        <div className="mt-3 max-w-[820px]">
          <p
            ref={descRef}
            className={`whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--text-2)] ${
              descOpen ? '' : 'line-clamp-2'
            }`}
          >
            {descriptionNodes(data.desc, onSeek)}
          </p>
          {/* 长简介按 B 站收两行；短简介不需要那个按钮。 */}
          {descCanExpand ? (
            <button
              type="button"
              onClick={() => {
                const next = !descOpen
                descOpenMemory.set(track.key, next)
                setDescOpen(next)
              }}
              className="t mt-1 text-[12px] text-[var(--accent)] hover:underline"
            >
              {descOpen ? '收起' : '展开更多'}
            </button>
          ) : null}
          <SourceLinks entries={sources} />
        </div>
      ) : null}

      {data.owner_mid ? (
        <SummaryCard trackKey={track.key} cid={cid} upMid={data.owner_mid} onSeek={onSeek} />
      ) : null}

      {tags.length > 0 ? (
        <div className="mt-2 flex max-w-[820px] flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setHeroQuery(tag)}
              className="t rounded-[3px] bg-[var(--ga0)] px-2 text-[12px] leading-[22px] text-[var(--text-2)] hover:bg-[var(--ga1)] hover:text-[var(--text-1)]"
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
