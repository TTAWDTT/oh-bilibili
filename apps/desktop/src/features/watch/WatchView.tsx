import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { toDanmakuItems } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useReactionStore } from '../reactions/reactionStore'
import { toastDone } from '../../app/notice'
import { Icon } from '../../shared/ui/Icon'
import { CommentsPanel } from './CommentsPanel'
import { ChapterList } from './ChapterList'
import { DanmakuList } from './DanmakuList'
import { OwnerCard } from './OwnerCard'
import { PageList } from './PageList'
import { RelatedAside } from './RelatedAside'
import { SeasonList } from './SeasonList'
import { TripleBurst } from './TripleBurst'
import { WatchHead, WatchInfo } from './WatchInfo'
import { WatchPlayer } from './WatchPlayer'
import { FavPicker } from '../library/FavPicker'
import { usePlayerStore } from '../player/playerStore'

function loadWatchPage(key: string): number | null {
  try {
    const page = Number(localStorage.getItem(`oh-bilibili:watch-page:${key}`))
    return Number.isInteger(page) && page > 0 ? page : null
  } catch {
    return null
  }
}

function saveWatchPage(key: string, page: number): void {
  try {
    localStorage.setItem(`oh-bilibili:watch-page:${key}`, String(page))
  } catch {
    // 隐私模式写不进去，只影响这次会话
  }
}

function loadPagePos(key: string, page: number): number | null {
  try {
    const at = Number(localStorage.getItem(`oh-bilibili:watch-pos:${key}:${page}`))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

function savePagePos(key: string, page: number, at: number): void {
  try {
    localStorage.setItem(`oh-bilibili:watch-pos:${key}:${page}`, String(Math.round(at)))
  } catch {
    // 隐私模式写不进去，只影响这次会话
  }
}

function clearPagePos(key: string, page: number): void {
  try {
    localStorage.removeItem(`oh-bilibili:watch-pos:${key}:${page}`)
  } catch {
    // 隐私模式写不进去，只影响这次会话
  }
}

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
  const osFullscreen = useAppStore((s) => s.osFullscreen)
  const setCinema = useAppStore((s) => s.setCinema)
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
  const [fansDelta, setFansDelta] = useState(0)
  // 三连庆祝的场次：自增一次播一遍，0 表示还没播过。
  const [burst, setBurst] = useState(0)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const storedPage = useRef(loadWatchPage(track.key)).current
  const storedPagePos = useRef(storedPage ? loadPagePos(track.key, storedPage) : null).current
  const [page, setPage] = useState<number | undefined>(storedPage ?? undefined)
  /** 下一次取清单时要告诉引擎从这个 P 的哪个位置起播。 */
  const [pendingResume, setPendingResume] = useState<number | null>(storedPagePos)
  const initialStoredPage = useRef(page !== undefined)
  // 换 P 后播放器在页面顶部，显式回顶，别依赖数据重载把滚动容器撑矮这种副作用。
  useEffect(() => {
    if (page === undefined) return
    document.getElementById('scroll-main')?.scrollTo({ top: 0 })
  }, [page])
  /** 换 P 是另一条播放位置：先存走这一 P 的进度，再取下一 P 自己的。 */
  const changePage = (no: number): void => {
    const from = page ?? data?.current_page
    const snap = usePlayerStore.getState().snapshot
    // 快照只在命令时更新，真实播放位置在 progress 切片里（10Hz）。
    const now = usePlayerStore.getState().progress.position_ms
    if (from !== undefined && snap?.track?.key === track.key && now >= 5000) {
      savePagePos(track.key, from, now)
    }
    const at = loadPagePos(track.key, no)
    setResume(at ? { key: track.key, at } : null)
    setPendingResume(at)
    setPage(no)
    saveWatchPage(track.key, no)
  }
  /** 上一次取清单的视频；同一条视频换 P 时保留旧画面，别闪一下黑屏。 */
  const lastTrackRef = useRef<string | null>(null)
  const [nonce, setNonce] = useState(0)
  /** 当前在看人数。取不到就不显示，不猜。 */
  const [online, setOnline] = useState<number | null>(null)
  /** 这条视频有哪些字幕轨；空表示没有字幕，播放器就不放「字幕」按钮。 */
  const [subTracks, setSubTracks] = useState<ipc.SubtitleTrack[]>([])
  /** UP 主设的章节。 */
  const [metaChapters, setMetaChapters] = useState<{ at_ms: number; title: string }[]>([])
  /** 外部（章节/总结/简介）点时间戳时发一次定位请求，由播放器统一改声音与画面。 */
  const [seekSignal, setSeekSignal] = useState<{ at: number; nonce: number } | null>(null)
  const seekTo = (ms: number): void =>
    setSeekSignal((previous) => ({ at: ms, nonce: (previous?.nonce ?? 0) + 1 }))
  /** 上次看到的位置，带 key：换片瞬间旧值不能落进新视频。 */
  const [resume, setResume] = useState<{ key: string; at: number } | null>(
    storedPagePos ? { key: track.key, at: storedPagePos } : null,
  )
  /** UP 主名片与关注状态。右栏和窄屏的行都用同一份，两处不会各说各话。 */
  const [card, setCard] = useState<ipc.AuthorCard | null>(null)
  const [followed, setFollowed] = useState<boolean | null>(null)
  /** 收藏要先选收藏夹，和 B 站网页版、列表卡片的行为一致。 */
  const [pickingFav, setPickingFav] = useState(false)
  const [favBusy, setFavBusy] = useState(false)
  const favToStore = useReactionStore((st) => st.favTo)

  // 标题行要用到「N 人在看」，所以这一条请求放在页面级：它和标题一起在播放器上方。
  useEffect(() => {
    const cid = data?.pages.find((p) => p.no === data.current_page)?.cid
    if (!cid) return
    let cancelled = false
    setOnline(null)
    setSubTracks([])
    setMetaChapters([])
    void ipc
      .watchMeta(track.key, cid)
      .then((meta) => {
        if (cancelled) return
        setOnline(meta.online)
        setSubTracks(meta.subtitles)
        setMetaChapters(meta.chapters)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track.key, data])

  // 离开观看页就收声音。引擎感知不到页面切换，之前退出后声音会一直放，
  // 而那时连播放条都不显示，用户没有任何地方能把它停掉。
  useEffect(() => {
    return () => {
      void ipc.playerPause().catch(() => {})
    }
  }, [])

  useEffect(() => {
    setLikeDelta(0)
    setFavDelta(0)
    setCoinDelta(0)
  }, [track.key])

  useEffect(() => {
    let cancelled = false
    // 从记住的 P 打开时不沿用 bvid 级历史：它可能属于上一 P。
    if (initialStoredPage.current) return
    setResume(null)
    void ipc
      .historyPosition(track.key)
      .then((at) => {
        if (!cancelled && at) setResume({ key: track.key, at })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track.key])

  // 每条 P 各记一份进度；切 P 与离开页面时由 effect 清理补写一次。
  useEffect(() => {
    const save = (): void => {
      const snap = usePlayerStore.getState().snapshot
      if (!snap || snap.track?.key !== track.key) return
      const no = page ?? data?.current_page
      if (no === undefined || !data || data.current_page !== no) return
      if (snap.phase === 'ended') {
        clearPagePos(track.key, no)
        return
      }
      const at = usePlayerStore.getState().progress.position_ms
      // 刚切 P 时声音还没起来，进度会短暂为 0；这时不能清掉这一 P 的记录。
      if (at < 5000) return
      if (data.duration_ms > 0 && at > data.duration_ms - 10_000) return
      savePagePos(track.key, no, at)
    }
    const timer = window.setInterval(save, 5000)
    return () => {
      window.clearInterval(timer)
      save()
    }
  }, [track.key, page, data])

  const mid = data?.owner_mid ?? null

  useEffect(() => {
    let cancelled = false
    setCard(null)
    setFollowed(null)
    setFansDelta(0)
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
        setFansDelta((n) => n + (next ? 1 : -1))
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

  const coin = (count: number, alsoLike: boolean, quiet = false): void => {
    void useReactionStore
      .getState()
      .addCoin(track, count, alsoLike)
      .then((ok) => {
        if (!ok) return
        setCoinDelta((n) => n + count)
        if (!quiet) toastDone('投币成功', alsoLike ? '同时点了个赞' : null)
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
    // 一键三连按 B 站语义把硬币补满 2 枚；已经投过 1 枚的只补差额。
    if (needCoin) coin(2 - (st.coins[track.key] ?? 0), true, true)
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

  /** 已收藏是取消，未收藏才弹收藏夹。 */
  const openFav = (): void => {
    if (faved) {
      fav()
      return
    }
    setPickingFav(true)
  }

  const favTo = async (folderId: number | null): Promise<void> => {
    setFavBusy(true)
    try {
      await favToStore(track, folderId)
      setFavDelta((n) => n + 1)
      toastDone('已收藏', folderId === null ? '收进了默认收藏夹' : '已收进所选收藏夹')
      setPickingFav(false)
    } catch {
      // store 里已经提示过，这里只负责收尾
    } finally {
      setFavBusy(false)
    }
  }

  const currentPageNo = page ?? data?.current_page ?? 1
  const chapters = metaChapters.map((chapter) => ({ at: chapter.at_ms, title: chapter.title }))
  const pageIndex = data?.pages.findIndex((entry) => entry.no === currentPageNo) ?? -1
  const nextPage = pageIndex >= 0 ? data?.pages[pageIndex + 1] ?? null : null
  const nextTitle = nextPage
    ? nextPage.title || `第 ${nextPage.no} P`
    : related[0]?.title ?? null
  const playNext = (): void => {
    if (nextPage) {
      changePage(nextPage.no)
      return
    }
    const track = related[0]
    if (track) replace({ kind: 'watch', track })
  }

  // 取清单与档位
  useEffect(() => {
    let cancelled = false
    // 同一条视频换 P 时保留旧清单：播放器先停在旧画面上，
    // 新清单到了再换流，避免中间闪一块黑骨架。换视频仍然清空。
    const sameTrack = lastTrackRef.current === track.key
    lastTrackRef.current = track.key
    if (!sameTrack) setData(null)
    setError(null)
    void (async () => {
      try {
        const next = await ipc.watchOpen(track.key, page, pendingResume ?? undefined)
        if (!cancelled) {
          initialStoredPage.current = false
          if (page !== undefined && !next.pages.some((entry) => entry.no === page)) {
            const fallback = next.current_page
            const at = loadPagePos(track.key, fallback)
            setPage(fallback)
            setPendingResume(at)
            setResume(at ? { key: track.key, at } : null)
            saveWatchPage(track.key, fallback)
          }
          setData(next)
        }
      } catch (e) {
        if (!cancelled) setError(toWireError(e).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [track.key, page, pendingResume, nonce])

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
      {cinema && !osFullscreen ? (
        <button
          type="button"
          onClick={() => setCinema(false)}
          className="absolute right-4 top-4 z-50 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12px] text-white ring-1 ring-white/25 backdrop-blur hover:bg-black/75"
        >
          <Icon name="close" size={13} />
          退出网页全屏
        </button>
      ) : null}
      <TripleBurst run={burst} />
      <FavPicker open={pickingFav} busy={favBusy} onClose={() => setPickingFav(false)} onPick={(folderId) => void favTo(folderId)} />
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
                subtitleTracks={subTracks}
                onDanmakuSent={(item) => setDanmaku((prev) => [...prev, item])}
                liked={liked}
                faved={faved}
                onLike={like}
                onFav={openFav}
                onCoin={() => coin(1, true)}
                coins={coins}
                onReplay={() => {
                  void ipc.playerReplay().catch(() => {})
                }}
                nextTitle={nextTitle}
                onNext={playNext}
                seekSignal={seekSignal}
                currentPage={currentPageNo}
                onPage={changePage}
                resumeAt={resume?.key === track.key ? resume.at : null}
                chapters={chapters}
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
              likeDelta={likeDelta}
              favDelta={favDelta}
              coinDelta={coinDelta}
              onCoin={coin}
              onLike={like}
              onFav={openFav}
              onTriple={triple}
              onSeek={seekTo}
              ownerRow={
                <OwnerCard
                  data={data}
                  card={card}
                  followed={followed}
                  fansDelta={fansDelta}
                  onFollow={toggleFollow}
                  inline
                />
              }
            />
          ) : null}
          {!cinema && danmaku.length > 0 ? (
            <div className="border-t border-hairline md:hidden">
              <DanmakuList items={danmaku} />
            </div>
          ) : null}
          {!cinema && data && data.pages.length > 1 ? (
            <div className="border-t border-hairline md:hidden">
              <PageList pages={data.pages} current={page ?? data.current_page} onPage={changePage} />
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
            {data ? (
              <OwnerCard
                data={data}
                card={card}
                followed={followed}
                fansDelta={fansDelta}
                onFollow={toggleFollow}
              />
            ) : null}
            <DanmakuList items={danmaku} />
            {data ? <ChapterList desc={data.desc} chapters={chapters} onSeek={seekTo} /> : null}
            {data ? <PageList pages={data.pages} current={page ?? data.current_page} onPage={changePage} /> : null}
            {data?.season ? <SeasonList season={data.season} /> : null}
            <RelatedAside items={related} />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
