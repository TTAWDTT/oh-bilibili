import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
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
  onBack,
  onListen,
}: {
  track: Track
  data: WatchData
  onPage: (no: number) => void
  onBack: () => void
  /** 把当前画面位置交给音频引擎，切到听模式。 */
  onListen: (atMs: number) => void
}) {
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const toggleLike = useReactionStore((st) => st.toggleLike)
  const toggleFav = useReactionStore((st) => st.toggleFav)
  const addCoin = useReactionStore((st) => st.addCoin)

  const [saved, setSaved] = useState(false)
  /** null 表示还没读到（未登录或请求失败），此时不显示关注按钮。 */
  const [followed, setFollowed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    setSaved(false)
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

  return (
    <div className="pb-4 pt-4">
      {/* 返回、标题、听视频排在同一行：单独一条只有箭头的工具栏看着像丢了内容。 */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="t press mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] hover:bg-[var(--panel-alt)]"
        >
          <Icon name="chevronLeft" size={16} />
        </button>
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
      </div>

      <div className="mt-3 flex items-center gap-3 border-b border-hairline pb-3">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar src={data.owner_avatar ?? track.up_avatar ?? null} alt={data.owner} size={28} />
          <span className="truncate text-[14px] text-[var(--text-2)]">{data.owner}</span>
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
        <button type="button" aria-pressed={liked} onClick={() => void toggleLike(track)} className={pill(liked)}>
          <BiliThumb size={15} />
          {formatCount(data.stats.likes)}
        </button>
        <button
          type="button"
          aria-pressed={coins > 0}
          onClick={() => {
            if (coins >= 2) {
              toastDone('已经投过两枚', 'B 站上限 2 枚')
              return
            }
            void addCoin(track, 1)
          }}
          className={pill(coins > 0)}
        >
          <BiliCoin size={15} />
          {formatCount(data.stats.coins)}
        </button>
        <button type="button" aria-pressed={faved} onClick={() => void toggleFav(track)} className={pill(faved)}>
          <BiliStar size={15} />
          {formatCount(data.stats.favorites)}
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
          className={pill(saved)}
        >
          <Icon name="watchLater" size={14} />
          {saved ? '已加入' : '稍后再看'}
        </button>
        <button type="button" className={pill(false)}>
          <Icon name="copy" size={14} />
          {formatCount(data.stats.shares)}
        </button>
      </div>

      {data.desc ? (
        <p className="mt-3 max-w-[820px] whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--text-2)]">
          {data.desc}
        </p>
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
