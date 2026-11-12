import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount, formatDate } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { copyText } from '../../shared/lib/clipboard'
import { toastDone } from '../../app/notice'
import { useReactionStore } from '../reactions/reactionStore'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'

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
}) {
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)

  const [saved, setSaved] = useState(false)
  /** UP 主粉丝数。B 站把「粉丝 123.4万」挂在 UP 名字后面。 */
  const [fans, setFans] = useState<number | null>(null)
  /** 简介默认收两行，长简介给一个展开。 */
  const [descOpen, setDescOpen] = useState(false)
  const [confirmingCoin, setConfirmingCoin] = useState(false)
  /** 详情里的投币数是打开那一刻的快照，自己投出去的要自己加上。 */
  /** null 表示还没读到（未登录或请求失败），此时不显示关注按钮。 */
  const [followed, setFollowed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    setSaved(false)
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
        {/* B 站这一行的尾巴是投稿日期，分区名跟在后面。 */}
        {data.pubdate > 0 ? <span className="num">{formatDate(data.pubdate)}</span> : null}
        {data.tname ? (
          <span className="rounded-[3px] bg-[var(--panel-raised)] px-1.5 leading-[18px] text-[var(--text-2)]">
            {data.tname}
          </span>
        ) : null}
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
          onClick={onLike}
          className={triple(liked, 'left')}
          title={liked ? '取消点赞' : '点赞'}
        >
          <BiliThumb size={15} />
          {formatCount(Math.max(0, data.stats.likes + likeDelta))}
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
            {data.desc}
          </p>
          {/* 长简介按 B 站收两行；短简介不需要那个按钮。 */}
          {data.desc.length > 90 ? (
            <button
              type="button"
              onClick={() => setDescOpen((open) => !open)}
              className="t mt-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
            >
              {descOpen ? '收起' : '展开更多'}
            </button>
          ) : null}
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
