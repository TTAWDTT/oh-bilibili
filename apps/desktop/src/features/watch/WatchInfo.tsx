import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount, formatDate } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { copyText } from '../../shared/lib/clipboard'
import { toastDone, toastFailure } from '../../app/notice'
import { useReactionStore } from '../reactions/reactionStore'
import { Avatar } from '../../shared/ui/Avatar'
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
 * 观看页的信息与互动：UP 主、关注、计数、三连、稍后再看、简介、分P。
 *
 * 每个按钮都复述服务端的真实状态：点赞/收藏/投币来自 reaction store 的
 * 一次批量刷新，关注与稍后再看在这里各自读一次，读不到就不显示或标成未点。
 */
export function WatchInfo({
  track,
  data,
  onPage,
  onListen,
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
  /** 把当前画面位置交给音频引擎，切到听模式。 */
  onListen: (atMs: number) => void
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
  /** 当前在看人数。取不到就不显示，不猜。 */
  const [online, setOnline] = useState<number | null>(null)
  /** UP 主粉丝数。B 站把「粉丝 123.4万」挂在 UP 名字后面。 */
  const [fans, setFans] = useState<number | null>(null)
  /** 简介默认收两行，长简介给一个展开。 */
  const [descOpen, setDescOpen] = useState(false)
  const [confirmingCoin, setConfirmingCoin] = useState(false)
  /** 长按点赞：按住 550ms 触发一键三连。松手就算普通点赞。 */
  const [holding, setHolding] = useState(false)
  const holdTimer = useRef<number | null>(null)
  const longFired = useRef(false)
  /** 详情里的投币数是打开那一刻的快照，自己投出去的要自己加上。 */
  /** null 表示还没读到（未登录或请求失败），此时不显示关注按钮。 */
  const [followed, setFollowed] = useState<boolean | null>(null)
  const setHeroQuery = useAppStore((state) => state.setHeroQuery)

  useEffect(() => {
    let cancelled = false
    setSaved(false)
    setTags([])
    setFans(null)
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

  const cid = data.pages.find((p) => p.no === data.current_page)?.cid

  useEffect(() => {
    if (!cid) return
    let cancelled = false
    setOnline(null)
    void ipc
      .videoOnline(track.key, cid)
      .then((count) => {
        if (!cancelled) setOnline(count)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track.key, cid])

  useEffect(() => {
    let cancelled = false
    setFollowed(null)
    if (!data.owner_mid) return
    void ipc
      .spaceStat(data.owner_mid)
      .then(([fanCount]) => {
        if (!cancelled) setFans(fanCount)
      })
      .catch(() => {})
    void ipc
      .relationFollowed(data.owner_mid)
      .then((on) => {
        if (!cancelled) setFollowed(on)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [data.owner_mid])

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

  /** 胶囊按钮：B 站视频页的每个操作都是这个形状，图标 + 文字 + 数字。 */
  const pill = (on: boolean): string =>
    [
      't press flex h-8 items-center gap-1.5 rounded-[6px] border px-3 text-[13px]',
      on
        ? 'border-[var(--accent)] text-[var(--accent)]'
        : 'border-[var(--line)] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
    ].join(' ')

  /**
   * 三连的三段。B 站把点赞/投币/收藏连成一排，中间没有缝；
   * 分成三个独立胶囊就看不出它们是同一组动作。
   */
  const triple = (on: boolean, edge: 'left' | 'middle' | 'right'): string =>
    [
      't press flex h-9 items-center gap-1.5 border border-[var(--line)] px-4 text-[13px] first:border-l',
      edge === 'left' ? 'rounded-l-[6px] border-r-0' : '',
      edge === 'middle' ? 'border-r-0' : '',
      edge === 'right' ? 'rounded-r-[6px]' : '',
      on ? 'text-[var(--accent)]' : 'text-[var(--text-1)] hover:text-[var(--accent)]',
    ].join(' ')

  return (
    <div className="pb-4 pt-4">
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

      <div className="mt-3 flex items-center gap-3 border-b border-hairline pb-3">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar src={data.owner_avatar ?? track.up_avatar ?? null} alt={data.owner} size={28} />
          <span className="truncate text-[14px] text-[var(--text-2)]">{data.owner}</span>
          {fans !== null ? (
            <span className="num shrink-0 text-[12px] text-[var(--text-3)]">
              粉丝 {formatCount(fans)}
            </span>
          ) : null}
        </span>
        {data.owner_mid && followed !== null ? (
          <button
            type="button"
            aria-pressed={followed}
            onClick={() => {
              const next = !followed
              void ipc
                .followSet(data.owner_mid!, next)
                .then(() => {
                  setFollowed(next)
                  toastDone(next ? '已关注' : '已取消关注')
                })
                .catch(() => toastDone(next ? '关注失败' : '取消关注失败', '登录后再试'))
            }}
            className={`t press h-8 shrink-0 rounded-[6px] px-4 text-[13px] ${
              followed
                ? 'border border-[var(--line)] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                : 'bg-[var(--accent)] text-white hover:opacity-90'
            }`}
          >
            {followed ? '已关注' : '关注'}
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-stretch">
        <button
          type="button"
          aria-pressed={liked}
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
          className={`${triple(liked, 'left')} relative overflow-hidden`}
          title={liked ? '取消点赞（长按一键三连）' : '点赞（长按一键三连）'}
        >
          <BiliThumb size={15} />
          {formatCount(Math.max(0, data.stats.likes + likeDelta))}
          {holding ? (
            <span className="bili-hold-bar absolute inset-x-0 bottom-0 h-[2px] bg-[var(--accent)]" />
          ) : null}
        </button>
        <button
          type="button"
          aria-pressed={coins > 0}
          onClick={() => {
            if (coins >= 2) {
              toastDone('已经投过两枚', 'B 站上限 2 枚')
              return
            }
            setConfirmingCoin(true)
          }}
          className={triple(coins > 0, 'middle')}
          title="投币"
        >
          <BiliCoin size={15} />
          {formatCount(data.stats.coins + coinDelta)}
        </button>
        <button
          type="button"
          aria-pressed={faved}
          onClick={onFav}
          className={triple(faved, 'right')}
          title={faved ? '取消收藏' : '收藏'}
        >
          <BiliStar size={15} />
          {formatCount(Math.max(0, data.stats.favorites + favDelta))}
        </button>
        </div>
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
          className={pill(saved)}
        >
          <Icon name="watchLater" size={14} />
          {saved ? '已加入' : '稍后再看'}
        </button>
        <button
          type="button"
          title="复制视频链接"
          aria-label="复制视频链接"
          onClick={() => {
            void copyText(`https://www.bilibili.com/video/${track.key}`).then((ok) =>
              toastDone(ok ? '链接已复制' : '复制失败'),
            )
          }}
          className={pill(false)}
        >
          <Icon name="copy" size={14} />
          {formatCount(data.stats.shares)}
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
        <div className="mt-3 flex gap-1 overflow-x-auto">
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
