import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount, formatDate } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { copyText } from '../../shared/lib/clipboard'
import { toastDone, toastFailure } from '../../app/notice'
import { useReactionStore } from '../reactions/reactionStore'
import { Icon } from '../../shared/ui/Icon'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'

/** 简介里的链接单独成段；长 URL 可以断行，点开走系统浏览器。 */
function descriptionNodes(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => {
    if (!/^https?:\/\//.test(part)) return part
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
  online,
  onListen,
}: {
  track: Track
  data: WatchData
  online: number | null
  onListen: (atMs: number) => void
}) {
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
  onPage,
  likeDelta,
  favDelta,
  coinDelta,
  onLike,
  onFav,
  onCoin,
  onTriple,
}: {
  track: Track
  data: WatchData
  onPage: (no: number) => void
  /** 点赞与收藏的计数偏移由观看页统一持有，这里只负责显示。 */
  likeDelta: number
  favDelta: number
  coinDelta: number
  onLike: () => void
  onFav: () => void
  onCoin: () => void
  /** 长按点赞：B 站的一键三连。 */
  onTriple: () => void
}) {
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)

  const [saved, setSaved] = useState(false)
  /** 视频标签。公开接口，取不到就不显示这一行。 */
  const [tags, setTags] = useState<string[]>([])
  /** 简介默认收两行，长简介给一个展开。 */
  const [descOpen, setDescOpen] = useState(false)
  const [confirmingCoin, setConfirmingCoin] = useState(false)
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
    setConfirmingCoin(false)
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

  /**
   * 操作项。B 站网页版的工具栏没有边框：图标 + 数字平铺一排，悬停才给一层浅底。
   * 做成胶囊会让这一行看起来像一排按钮，而 B 站把它当成视频信息的附注。
   */
  const action = (on: boolean): string =>
    [
      'bili-icon-btn t press flex h-9 shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 text-[13px]',
      on
        ? 'text-[var(--accent)]'
        : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)] hover:text-[var(--accent)]',
    ].join(' ')

  return (
    <div className="pb-4 pt-3">
      <div className="no-scrollbar mt-3 flex items-center gap-1.5 overflow-x-auto border-y border-hairline py-1.5">
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
          className={`${action(liked)} relative overflow-hidden`}
          title={liked ? '取消点赞（长按一键三连）' : '点赞（长按一键三连）'}
        >
          <span key={liked ? 'on' : 'off'} className={liked ? 'bili-tri-pop' : undefined}>
            <BiliThumb size={19} />
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
          onClick={() => {
            if (coins >= 2) {
              toastDone('已经投过两枚', 'B 站上限 2 枚')
              return
            }
            setConfirmingCoin(true)
          }}
          className={action(coins > 0)}
          title="投币"
        >
          <span key={coins} className={coins > 0 ? 'bili-tri-flip' : undefined}>
            <BiliCoin size={19} />
          </span>
          {formatCount(data.stats.coins + coinDelta)}
        </button>
        <button
          type="button"
          aria-pressed={faved}
          aria-label={faved ? '取消收藏' : '收藏'}
          onClick={onFav}
          className={action(faved)}
          title={faved ? '取消收藏' : '收藏'}
        >
          <span key={faved ? 'on' : 'off'} className={faved ? 'bili-tri-spin' : undefined}>
            <BiliStar size={19} />
          </span>
          {formatCount(Math.max(0, data.stats.favorites + favDelta))}
        </button>
        <button
          type="button"
          title="分享，复制视频链接"
          aria-label="分享，复制视频链接"
          onClick={() => {
            void copyText(`https://www.bilibili.com/video/${track.key}`).then((ok) =>
              toastDone(ok ? '链接已复制' : '复制失败'),
            )
          }}
          className={action(false)}
        >
          <Icon name="share" size={19} />
          {formatCount(data.stats.shares)}
        </button>
        <span className="mx-1.5 h-4 w-px shrink-0 bg-[var(--line)]" />
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
          <Icon name="watchLater" size={18} />
          {saved ? '已加入' : '稍后再看'}
        </button>
      </div>
      {confirmingCoin ? (
        <div className="mt-2 flex items-center gap-2 rounded-[4px] bg-[var(--panel-raised)] px-2 py-1.5 text-[12px]">
          <span className="text-[var(--text-2)]">投 1 枚硬币？不可撤销</span>
          <button
            type="button"
            onClick={() => {
              setConfirmingCoin(false)
              onCoin()
            }}
            className="rounded-[3px] bg-[var(--accent)] px-2 text-white"
          >
            投
          </button>
          <button
            type="button"
            onClick={() => setConfirmingCoin(false)}
            className="text-[var(--text-3)] hover:text-[var(--text-1)]"
          >
            取消
          </button>
        </div>
      ) : null}

      {data.desc ? (
        <div className="mt-3 max-w-[820px]">
          <p
            className={`whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--text-2)] ${
              descOpen ? '' : 'line-clamp-2'
            }`}
          >
            {descriptionNodes(data.desc)}
          </p>
          {/* 长简介按 B 站收两行；短简介不需要那个按钮。 */}
          {data.desc.length > 90 ? (
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

      {data.pages.length > 1 ? (
        <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto">
          {data.pages.map((p) => (
            <button
              key={p.cid}
              type="button"
              aria-pressed={p.no === data.current_page}
              onClick={() => onPage(p.no)}
              title={p.title}
              className={`t press shrink-0 rounded-[6px] px-2 py-1 text-[12px] ${
                p.no === data.current_page
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)]'
              }`}
            >
              P{p.no} {p.title.slice(0, 12) || '分P'}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
