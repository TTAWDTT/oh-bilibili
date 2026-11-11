import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount } from '../../shared/lib/format'
import { toastDone } from '../../app/notice'
import { useReactionStore } from '../reactions/reactionStore'
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
}: {
  track: Track
  data: WatchData
  onPage: (no: number) => void
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

  const actionClass = (on: boolean): string =>
    `t press flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] ${
      on ? 'text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--panel-alt)]'
    }`

  return (
    <div className="border-t border-hairline px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--text-2)]">
        <span className="font-medium text-[var(--text-1)]">{data.owner}</span>
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
            className={`t press rounded-[4px] px-2 py-0.5 text-[12px] ${
              followed ? 'bg-[var(--panel-alt)] text-[var(--text-2)]' : 'bg-[var(--accent)] text-white'
            }`}
          >
            {followed ? '已关注' : '关注'}
          </button>
        ) : null}
        <span className="num">{formatCount(data.stats.views)} 播放</span>
        <span className="num">{formatCount(data.stats.danmaku)} 弹幕</span>
        <span className="num">{formatCount(data.stats.likes)} 点赞</span>
        <span className="num">{formatCount(data.stats.coins)} 投币</span>
        <span className="num">{formatCount(data.stats.favorites)} 收藏</span>
        <span className="num">{formatCount(data.stats.shares)} 分享</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-pressed={liked}
          onClick={() => void toggleLike(track)}
          className={actionClass(liked)}
        >
          <BiliThumb size={14} />
          {liked ? '已点赞' : '点赞'}
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
          className={actionClass(coins > 0)}
        >
          <BiliCoin size={14} />
          {coins > 0 ? `已投 ${coins} 枚` : '投币'}
        </button>
        <button
          type="button"
          aria-pressed={faved}
          onClick={() => void toggleFav(track)}
          className={actionClass(faved)}
        >
          <BiliStar size={14} />
          {faved ? '已收藏' : '收藏'}
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
          className={actionClass(saved)}
        >
          <Icon name="watchLater" size={13} />
          {saved ? '已加入稍后再看' : '稍后再看'}
        </button>
      </div>

      {data.desc ? (
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-[1.5] text-[var(--text-3)]">
          {data.desc}
        </p>
      ) : null}

      {data.pages.length > 1 ? (
        <div className="mt-2 flex gap-1 overflow-x-auto">
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
