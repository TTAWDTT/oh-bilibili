import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { toDanmakuItems } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useReactionStore } from '../reactions/reactionStore'
import { toastDone } from '../../app/notice'
import { CommentsPanel } from './CommentsPanel'
import { DanmakuList } from './DanmakuList'
import { OwnerCard } from './OwnerCard'
import { RelatedAside } from './RelatedAside'
import { SeasonList } from './SeasonList'
import { TripleBurst } from './TripleBurst'
import { WatchHead, WatchInfo } from './WatchInfo'
import { WatchPlayer } from './WatchPlayer'

/**
 * 观看页。只负责取数与拼装：播放器、信息区、评论区、右栏各是一块。
 *
 * 声音只有一个发声者，就是音频引擎；画面跟着引擎的时钟走。
 * 清单与分片都走本机代理，前端拿不到任何远端地址。
 */
export function WatchView({ track }: { track: Track }) {
  const goBack = useAppStore((s) => s.goBack)
  const replace = useAppStore((s) => s.replace)
  const cinema = useAppStore((s) => s.cinema)
  const [data, setData] = useState<WatchData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([])
  const [related, setRelated] = useState<Track[]>([])
  const refresh = useReactionStore((st) => st.refresh)
  // 点赞与收藏的计数偏移放在这里：画面上的三连和下方信息区是同一份状态，
  // 各算一份就会出现「上面点了、下面的数字没动」。
  const [likeDelta, setLikeDelta] = useState(0)
  const [favDelta, setFavDelta] = useState(0)
  const [coinDelta, setCoinDelta] = useState(0)
  // 三连庆祝的场次：自增一次播一遍，0 表示还没播过。
  const [burst, setBurst] = useState(0)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const [page, setPage] = useState<number | undefined>(undefined)
  const [nonce, setNonce] = useState(0)
  /** 当前在看人数。取不到就不显示，不猜。 */
  const [online, setOnline] = useState<number | null>(null)
  /** UP 主名片与关注状态。右栏和窄屏的行都用同一份，两处不会各说各话。 */
  const [card, setCard] = useState<ipc.AuthorCard | null>(null)
  const [followed, setFollowed] = useState<boolean | null>(null)

  // 标题行要用到「N 人在看」，所以这一条请求放在页面级：它和标题一起在播放器上方。
  useEffect(() => {
    const cid = data?.pages.find((p) => p.no === data.current_page)?.cid
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
  }, [track.key, data])

  useEffect(() => {
    setLikeDelta(0)
    setFavDelta(0)
    setCoinDelta(0)
  }, [track.key])

  const mid = data?.owner_mid ?? null

  useEffect(() => {
    let cancelled = false
    setCard(null)
    setFollowed(null)
    if (!mid) return
    void ipc
      .authorCard(mid)
      .then((next) => {
        if (!cancelled) setCard(next)
      })
      .catch(() => {})
    void ipc
      .relationFollowed(mid)
      .then((on) => {
        if (!cancelled) setFollowed(on)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mid])

  const toggleFollow = (): void => {
    if (!mid) return
    const next = followed !== true
    void ipc
      .followSet(mid, next)
      .then(() => {
        setFollowed(next)
        toastDone(next ? '已关注' : '已取消关注')
      })
      .catch(() => toastDone(next ? '关注失败' : '取消关注失败', '登录后再试'))
  }

  const like = (): void => {
    const before = useReactionStore.getState().liked[track.key] ?? false
    void useReactionStore
      .getState()
      .toggleLike(track)
      .then((next) => {
        if (next !== null && next !== before) setLikeDelta((n) => n + (next ? 1 : -1))
      })
  }

  const coin = (): void => {
    void useReactionStore
      .getState()
      .addCoin(track, 1)
      .then((ok) => {
        if (ok) setCoinDelta((n) => n + 1)
      })
  }

  /** 长按点赞：把三连补成「都有了」。已经点过的不重复点，避免把点赞点成取消。 */
  const triple = (): void => {
    const st = useReactionStore.getState()
    const needLike = !(st.liked[track.key] ?? false)
    const needFav = !(st.faved[track.key] ?? false)
    const needCoin = (st.coins[track.key] ?? 0) < 2
    if (!needLike && !needFav && !needCoin) {
      toastDone('已经三连过了')
      return
    }
    if (needLike) like()
    if (needCoin) coin()
    if (needFav) fav()
    setBurst((n) => n + 1)
    toastDone('一键三连', '点赞、投币、收藏都点上了')
  }

  const fav = (): void => {
    const before = useReactionStore.getState().faved[track.key] ?? false
    void useReactionStore
      .getState()
      .toggleFav(track)
      .then((next) => {
        if (next !== null && next !== before) setFavDelta((n) => n + (next ? 1 : -1))
      })
  }

  // 取清单与档位
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    void (async () => {
      try {
        const next = await ipc.watchOpen(track.key, page)
        if (!cancelled) setData(next)
      } catch (e) {
        if (!cancelled) setError(toWireError(e).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [track.key, page, nonce])

  // 离开这一页就停掉声音。切到「听」时引擎已经把模式改成 listen，
  // 那边的 close_watch 不会误停用户主动选的后台播放。
  useEffect(() => {
    return () => {
      void ipc.closeWatch(track.key).catch(() => {})
    }
    // 只在真正离开观看页时清理；换片由 key 比对保证不会误停新视频。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 取弹幕。时间轴跟引擎时钟走，画面只是它的跟随者。
  useEffect(() => {
    let cancelled = false
    setDanmaku([])
    void ipc
      .danmakuColored(track.key)
      .then((list) => {
        if (!cancelled) setDanmaku(toDanmakuItems(list))
      })
      .catch(() => setDanmaku([]))
    return () => {
      cancelled = true
    }
  }, [track.key])

  // 打开就把这条视频的真实点赞/收藏/投币状态拉回来，
  // 否则按钮看起来永远是未点过的。
  useEffect(() => {
    // 用 refresh 而不是 hydrate：hydrate 会跳过查过的 key，而详情页
    // 打开时必须显示服务端真实状态，不能吃缓存。
    void refresh([track.key]).catch(() => {
      // 未登录时拉不到，保持未点亮即可
    })
  }, [track.key, refresh])

  // 相关推荐。右栏只在「听」时出现，所以观看页要有自己的一份，
  // 否则看视频时完全没有相关推荐可点。
  useEffect(() => {
    let cancelled = false
    setRelated([])
    void ipc
      .related(track.key)
      .then((list) => {
        if (!cancelled) setRelated(list)
      })
      .catch(() => setRelated([]))
    return () => {
      cancelled = true
    }
  }, [track.key])

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <TripleBurst run={burst} />
      {/* 返回在顶栏（TitleBar），不在画面上：浮在视频角上会挡住画面内容。 */}
      {/* 左画面右推荐的布局：视频客户端的信息骨架，音乐播放器那套单列竖排不适用。 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 整页一起滚：播放器、信息、评论是一条纵向流。
            之前把评论塞进「播放器之后剩下的高度」，一屏不够高时评论区直接被压成 0。 */}
        <div
          data-scroll-root
          /* 回到顶部按钮按 id 找容器：观看页是最长的一页，少了这个 id 按钮永远不出现。 */
          id="scroll-main"
          className={
            cinema ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto px-6 pt-4'
          }
        >
          {/* B 站网页端把标题压在画面之上：先知道在放什么，再决定看不看。 */}
          {!cinema && data ? (
            <WatchHead
              track={track}
              data={data}
              online={online}
              onListen={(at) => {
                void ipc.setMode('listen', at, track.key).then(() => goBack()).catch(() => {})
              }}
            />
          ) : null}
          {data ? (
            <div className={cinema ? 'h-full' : 'overflow-hidden rounded-[8px]'}>
              <WatchPlayer
                track={track}
                data={data}
                danmaku={danmaku}
                onDanmakuSent={(item) => setDanmaku((prev) => [...prev, item])}
                liked={liked}
                faved={faved}
                onLike={like}
                onFav={fav}
                onCoin={coin}
                coins={coins}
                onReplay={() => {
                  void ipc.playerSeek(0).catch(() => {})
                }}
                next={related[0] ?? null}
                onNext={(nextTrack) => replace({ kind: 'watch', track: nextTrack })}
              />
            </div>
          ) : (
            <div className="aspect-video w-full shrink-0 bg-black" />
          )}
          {!cinema && error ? (
            <div className="flex items-center gap-3 border-b border-hairline px-3 py-2 text-[12px] text-[var(--text-3)]">
              <span className="min-w-0 flex-1">这条视频没打开：{error}</span>
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                className="t shrink-0 text-[var(--accent)]"
              >
                重试
              </button>
            </div>
          ) : null}
          {!cinema && data ? (
            <WatchInfo
              track={track}
              data={data}
              onPage={setPage}
              likeDelta={likeDelta}
              favDelta={favDelta}
              coinDelta={coinDelta}
              onCoin={coin}
              onLike={like}
              onFav={fav}
              onTriple={triple}
            />
          ) : null}
          {/* 右栏在窄屏收起，UP 名片跟着回到正文里，否则没有地方关注。 */}
          {!cinema && data ? (
            <div className="md:hidden">
              <OwnerCard data={data} card={card} followed={followed} onFollow={toggleFollow} />
            </div>
          ) : null}
          {/* 右栏在窄屏收起，推荐改到评论区上方，否则手机上看完这条就没有下一个可点。 */}
          {!cinema && data?.season ? (
            <div className="border-t border-hairline md:hidden">
              <SeasonList season={data.season} />
            </div>
          ) : null}
          {!cinema ? (
            <div className="border-t border-hairline md:hidden">
              <RelatedAside items={related} />
            </div>
          ) : null}
          {!cinema ? (
            <div className="border-t border-hairline">
              <CommentsPanel trackKey={track.key} ownerMid={data?.owner_mid ?? null} flow />
            </div>
          ) : null}
        </div>

        {!cinema ? (
          <aside className="hidden min-h-0 w-[var(--rail-w)] shrink-0 overflow-y-auto border-l border-hairline md:block">
            {data ? <OwnerCard data={data} card={card} followed={followed} onFollow={toggleFollow} /> : null}
            <DanmakuList items={danmaku} />
            {data?.season ? <SeasonList season={data.season} /> : null}
            <RelatedAside items={related} />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
