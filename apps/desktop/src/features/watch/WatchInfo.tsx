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
import { Modal } from '../../shared/ui/Modal'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'
import { SharePanel } from './SharePanel'
import { SummaryCard } from './SummaryCard'

/** 状态翻过一次才换 key，让扩散环重播；初次挂载返回 0，进页面时不会三颗一起闪。 */
function useFlipKey(value: boolean | number): number {
  const [key, setKey] = useState(0)
  const previous = useRef(value)
  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setKey((n) => n + 1)
  }, [value])
  return key
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
  online,
  onListen,
}: {
  track: Track
  data: WatchData
  currentPage: number
  online: number | null
  onListen: (atMs: number) => void
}) {
  const page = data.pages.find((entry) => entry.no === currentPage)
  return (
    <div className="pb-2">
      {/* 返回键在画面左上角；这里只留标题与「听视频」。 */}
      <div className="flex items-start gap-2">
        <h1
          className="min-w-0 flex-1 text-[20px] font-medium leading-[1.35] text-[var(--text-1)]"
          title={track.title}
        >
          {track.title}
        </h1>
        <button
          type="button"
          onClick={() => onListen(Math.round(readPlayhead()))}
          className="t press mt-0.5 h-7 shrink-0 rounded-[6px] border border-[var(--line)] px-2.5 text-[12px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          听视频
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

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-3)]">
        <span className="num">{formatCount(data.stats.views)} 播放</span>
        <span className="num">{formatCount(data.stats.danmaku)} 弹幕</span>
        <span className="num">{formatCount(data.stats.replies)} 评论</span>
        {online !== null && online > 0 ? (
          <span className="num">{formatCount(online)} 人在看</span>
        ) : null}
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
            void copyText(`https://www.bilibili.com/video/${track.key}`).then((ok) =>
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
  likeDelta,
  favDelta,
  coinDelta,
  onLike,
  onFav,
  onCoin,
  onTriple,
  onSeek,
  ownerRow,
}: {
  track: Track
  data: WatchData
  /** 点赞与收藏的计数偏移由观看页统一持有，这里只负责显示。 */
  likeDelta: number
  favDelta: number
  coinDelta: number
  onLike: () => void
  onFav: () => void
  onCoin: (count: number, alsoLike: boolean) => void
  /** 长按点赞：B 站的一键三连。 */
  onTriple: () => void
  /** 简介里的时间戳跳转。 */
  onSeek: (ms: number) => void
  /** 宽屏主栏的 UP 主行，插在标签之后、分P 之前。 */
  ownerRow?: React.ReactNode
}) {
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const likeRing = useFlipKey(liked)
  const coinRing = useFlipKey(coins)
  const favRing = useFlipKey(faved)
  const cid = data.pages.find((page) => page.no === data.current_page)?.cid ?? data.pages[0]?.cid ?? 0

  const [saved, setSaved] = useState(false)
  /** 视频标签。公开接口，取不到就不显示这一行。 */
  const [tags, setTags] = useState<string[]>([])
  /** 简介默认收两行，长简介给一个展开。 */
  const [descOpen, setDescOpen] = useState(false)
  const [descCanExpand, setDescCanExpand] = useState(false)
  const descRef = useRef<HTMLParagraphElement | null>(null)

  useEffect(() => {
    setDescOpen(false)
  }, [track.key])

  useEffect(() => {
    if (descOpen) return
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
      setDescCanExpand(full > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [data.desc, descOpen])
  /** 投币浮层的位置，null 表示没开。操作排是 overflow-x-auto，absolute 会被裁掉。 */
  const [coinAt, setCoinAt] = useState<{ left: number; top: number; anchorTop: number } | null>(null)
  const [shareAt, setShareAt] = useState<{ left: number; top: number; anchorTop: number } | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const [downloadPending, setDownloadPending] = useState(false)
  const downloadPendingRef = useRef(false)
  const download = useDownloadsStore((state) =>
    (state.items ?? []).find((entry) => entry.key === track.key),
  )
  const enqueueDownload = useDownloadsStore((state) => state.enqueue)
  const downloading = downloadPending || download?.state === 'queued' || download?.state === 'running'
  const downloaded = download?.state === 'done'
  const [coinPick, setCoinPick] = useState(1)
  const [alsoLike, setAlsoLike] = useState(true)
  /** 长按点赞：按住 550ms 触发一键三连。松手就算普通点赞。 */
  const [holding, setHolding] = useState(false)
  const holdTimer = useRef<number | null>(null)
  const longFired = useRef(false)
  /** 详情里的投币数是打开那一刻的快照，自己投出去的要自己加上。 */
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)

  useEffect(() => {
    let cancelled = false
    setSaved(false)
    setTags([])
    setDescOpen(false)
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
    return () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    }
  }, [])

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

  const startHold = (): void => {
    longFired.current = false
    setHolding(true)
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      longFired.current = true
      setHolding(false)
      onTriple()
    }, 550)
  }

  const endHold = (): void => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
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
      'bili-icon-btn t press flex h-10 shrink-0 items-center gap-2 rounded-[6px] px-2.5 text-[13px]',
      on
        ? 'text-[var(--accent)]'
        : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--accent)]',
    ].join(' ')

  return (
    <div className="pb-4 pt-3">
      <div className="no-scrollbar mt-2 flex items-center gap-3 overflow-x-auto border-y border-hairline py-1.5">
        <button
          type="button"
          aria-pressed={liked}
          aria-label={liked ? '取消点赞' : '点赞'}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onClick={() => {
            // 长按已经触发过三连，这一次松开不再当成普通点赞
            if (longFired.current) {
              longFired.current = false
              return
            }
            onLike()
          }}
          className={`${action(liked)} bili-tri-btn relative overflow-hidden`}
          title={liked ? '取消点赞（长按一键三连）' : '点赞（长按一键三连）'}
        >
          {likeRing > 0 ? (
            <span
              key={likeRing}
              aria-hidden
              className="bili-tri-ring pointer-events-none absolute inset-0 rounded-[4px] border border-current opacity-0"
            />
          ) : null}
          <span className="bili-tri-glyph">
            <span key={liked ? 'on' : 'off'} className={liked ? 'bili-tri-pop' : undefined}>
              <BiliThumb size={26} filled={liked} />
            </span>
          </span>
          {formatCount(Math.max(0, data.stats.likes + likeDelta))}
          {holding ? (
            <span className="bili-hold-bar absolute inset-x-0 bottom-0 h-[2px] bg-[var(--accent)]" />
          ) : null}
        </button>
        <button
          type="button"
          aria-pressed={coins > 0}
          aria-label="投币"
          onClick={openCoin}
          className={`${action(coins > 0)} bili-tri-btn relative overflow-hidden`}
          title="投币（W）"
        >
          {coinRing > 0 ? (
            <span
              key={coinRing}
              aria-hidden
              className="bili-tri-ring pointer-events-none absolute inset-0 rounded-[4px] border border-current opacity-0"
            />
          ) : null}
          <span className="bili-tri-glyph">
            <span key={coins} className={coins > 0 ? 'bili-tri-flip' : undefined}>
              <BiliCoin size={24} />
            </span>
          </span>
          {formatCount(data.stats.coins + coinDelta)}
        </button>
        <button
          type="button"
          aria-pressed={faved}
          aria-label={faved ? '取消收藏' : '收藏'}
          onClick={onFav}
          className={`${action(faved)} bili-tri-btn relative overflow-hidden`}
          title={faved ? '取消收藏（E）' : '收藏（E）'}
        >
          {favRing > 0 ? (
            <span
              key={favRing}
              aria-hidden
              className="bili-tri-ring pointer-events-none absolute inset-0 rounded-[4px] border border-current opacity-0"
            />
          ) : null}
          <span className="bili-tri-glyph">
            <span key={faved ? 'on' : 'off'} className={faved ? 'bili-tri-spin' : undefined}>
              <BiliStar size={24} filled={faved} />
            </span>
          </span>
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
        <button type="button" aria-label="视频笔记" onClick={openNote} className={action(false)}>
          <Icon name="note" size={20} />
          笔记
        </button>
        <button
          type="button"
          aria-pressed={downloaded}
          onClick={() => {
            if (downloadPendingRef.current || downloading || downloaded) return
            downloadPendingRef.current = true
            setDownloadPending(true)
            void enqueueDownload(track.key).finally(() => {
              downloadPendingRef.current = false
              setDownloadPending(false)
            })
          }}
          className={action(downloaded)}
        >
          <Icon name={downloaded ? 'check' : downloading ? 'clock' : 'download'} size={20} />
          {downloaded ? '已下载' : downloading ? '下载中' : '下载'}
        </button>
        <span className="mx-1.5 h-5 w-px shrink-0 bg-[var(--line)]" />
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
          className={action(false)}
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
        <SharePanel track={track} onClose={() => setShareAt(null)} />
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

      {/* B 站顺序：三连 → UP 行 → 简介 → 标签。UP 行紧跟操作排，不沉到标签后面。 */}
      {ownerRow ? <div className="mt-1">{ownerRow}</div> : null}

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
              onClick={() => setDescOpen((open) => !open)}
              className="t mt-1 text-[12px] text-[var(--accent)] hover:underline"
            >
              {descOpen ? '收起' : '展开更多'}
            </button>
          ) : null}
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
              className="t rounded-[3px] bg-[color-mix(in_oklab,var(--accent)_10%,white)] px-2 text-[12px] leading-[22px] text-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_18%,white)]"
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
