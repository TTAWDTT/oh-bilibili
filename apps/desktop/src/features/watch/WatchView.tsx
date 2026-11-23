import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatTime } from '../../shared/lib/format'
import { toDanmakuItems } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useReactionStore } from '../reactions/reactionStore'
import { toastDone, toastWarn } from '../../app/notice'
import { Icon } from '../../shared/ui/Icon'
import { CommentsPanel } from './CommentsPanel'
import { takeWatchScroll } from './watchScroll'
import {
  advanceWatchSession,
  currentWatchSession,
  endWatchSession,
  peekWatchSessionNext,
  skipWatchSession,
} from './watchSession'
import { ChapterList } from './ChapterList'
import { DanmakuList } from './DanmakuList'
import { OwnerCard } from './OwnerCard'
import { PageList } from './PageList'
import { RelatedAside } from './RelatedAside'
import { SeasonList } from './SeasonList'
import { TripleBurst } from './TripleBurst'
import { WatchHead, WatchInfo } from './WatchInfo'
import { WatchPlayer, type NextUp } from './WatchPlayer'
import { setWatchFavHandler } from './watchActions'
import { FavPicker } from '../library/FavPicker'
import { usePlayerStore } from '../player/playerStore'
import { Modal } from '../../shared/ui/Modal'

function loadWatchPage(key: string): number | null {
  try {
    const page = Number(localStorage.getItem(`oh-bilibili:watch-page:${key}`))
    if (Number.isInteger(page) && page > 0) return page
    // 单 P 视频从不写 watch-page，只有按页的进度；按它把页号找回来。
    const prefix = `oh-bilibili:watch-pos:${key}:`
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i)
      if (!name?.startsWith(prefix)) continue
      const found = Number(name.slice(prefix.length))
      if (Number.isInteger(found) && found > 0) return found
    }
    return null
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

/** 分 P 的真实时长单独记一份：历史里那条 track 的 duration 是整条投稿的总长。 */
function savePageLen(key: string, page: number, duration: number): void {
  try {
    localStorage.setItem(`oh-bilibili:watch-len:${key}:${page}`, String(Math.round(duration)))
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

/** 中窄窗选集入口上的一行字：分 P 用 P 序号，合集用集序。 */
function directoryTitle(data: WatchData, current: number): string {
  if (data.pages.length > 1) return `选集 · P${current}/${data.pages.length}`
  const season = data.season
  if (!season) return '选集'
  const index = season.episodes.findIndex((episode) => episode.current)
  return `选集 · ${index >= 0 ? index + 1 : current}/${season.episodes.length}`
}

/**
 * 观看页。只负责取数与拼装：播放器、信息区、评论区、右栏各是一块。
 *
 * 声音只有一个发声者，就是音频引擎；画面跟着引擎的时钟走。
 * 清单与分片都走本机代理，前端拿不到任何远端地址。
 */
export function WatchView({
  track,
  page: startPage,
  atMs,
}: {
  track: Track
  /** 从弹幕引文进来时直接落在这一分 P。 */
  page?: number
  /** 同一次跳转还要落到这条弹幕的时刻。 */
  atMs?: number
}) {
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
  const trackKeyRef = useRef(track.key)
  trackKeyRef.current = track.key
  const tripleBusy = useRef(false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const storedPage = useRef(startPage ?? loadWatchPage(track.key)).current
  const storedPagePos = useRef(storedPage ? loadPagePos(track.key, storedPage) : null).current
  const [page, setPage] = useState<number | undefined>(storedPage ?? undefined)
  /** 中窄窗的选集面板。宽窗用右栏目录，影院用播放器自带的选集。 */
  const [pickingPage, setPickingPage] = useState(false)
  const pageTriggerRef = useRef<HTMLButtonElement | null>(null)
  const pickingPageRef = useRef(false)
  useEffect(() => {
    if (pickingPage) {
      pickingPageRef.current = true
      return
    }
    if (!pickingPageRef.current) return
    pickingPageRef.current = false
    // 弹窗自己会把焦点还给打开前的元素；鼠标点按钮时那个元素可能不是按钮，
    // 所以这里显式还给选集入口。
    pageTriggerRef.current?.focus()
  }, [pickingPage])
  /** 下一次取清单时要告诉引擎从这个 P 的哪个位置起播。 */
  const [pendingResume, setPendingResume] = useState<number | null>(atMs ?? storedPagePos)
  const initialStoredPage = useRef(page !== undefined)
  // 换 P 后播放器在页面顶部，显式回顶，别依赖数据重载把滚动容器撑矮这种副作用。
  useEffect(() => {
    if (page === undefined) return
    document.getElementById('scroll-main')?.scrollTo({ top: 0 })
  }, [page])

  // 从合作成员空间返回同一个 BV 时，回到离开前的阅读位置（只恢复一次）。
  useEffect(() => {
    if (!data) return
    const top = takeWatchScroll(track.key)
    if (top !== null) document.getElementById('scroll-main')?.scrollTo({ top })
  }, [data, track.key])

  // 老版本只写过按页进度；拿到这一页的时长就补写一份，续播卡从此有页级时长可用。
  useEffect(() => {
    if (!data || data.duration_ms <= 0) return
    savePageLen(track.key, data.current_page, data.duration_ms)
  }, [data, track.key])
  /** 换 P 是另一条播放位置：先存走这一 P 的进度，再取下一 P 自己的。 */
  const changePage = (no: number, resumeAtMs?: number): void => {
    const from = page ?? data?.current_page
    const snap = usePlayerStore.getState().snapshot
    // 快照只在命令时更新，真实播放位置在 progress 切片里（10Hz）。
    const now = usePlayerStore.getState().progress.position_ms
    if (from !== undefined && snap?.track?.key === track.key && now >= 5000) {
      savePagePos(track.key, from, now)
      // 历史里的 duration 是整条投稿总长，分 P 要看观看数据里这一页的时长。
      if ((data?.duration_ms ?? 0) > 0) savePageLen(track.key, from, data!.duration_ms)
    }
    const at = resumeAtMs ?? loadPagePos(track.key, no)
    setResume(at ? { key: track.key, at } : null)
    setPendingResume(at)
    setPage(no)
    saveWatchPage(track.key, no)
  }
  /** 评论里的时间点：写明了别的 P 就先切过去，加载后落在同一毫秒。 */
  /** 评论笔记跨 P 的一次定位：目标 P 的媒体就绪后落位，并按跳转前恢复暂停。 */
  const [noteSeek, setNoteSeek] = useState<{
    page: number
    ms: number
    nonce: number
    paused: boolean
  } | null>(null)
  const seekFromComment = (ms: number, pageNo?: number): void => {
    const current = page ?? data?.current_page ?? 1
    if (pageNo !== undefined && pageNo !== current) {
      const target = data?.pages.find((entry) => entry.no === pageNo)
      if (!target) {
        toastWarn('这个分 P 不存在', `评论写的是 P${pageNo}`)
        return
      }
      if (ms > target.duration_ms) {
        toastWarn(
          '这个时间点超出分 P',
          `P${pageNo} 只有 ${formatTime(target.duration_ms)}，评论写的是 ${formatTime(ms)}`,
        )
        return
      }
      const paused = usePlayerStore.getState().snapshot?.phase !== 'playing'
      changePage(pageNo, ms)
      // 连续点两条时只留最后一次；迟到的旧跳转不会把画面拖回去。
      setNoteSeek((prev) => ({ page: pageNo, ms, nonce: (prev?.nonce ?? 0) + 1, paused }))
      return
    }
    seekTo(ms)
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
    atMs !== undefined
      ? { key: track.key, at: atMs }
      : storedPagePos
        ? { key: track.key, at: storedPagePos }
        : null,
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

  /** 选集每一行下面那条「看到哪了」。读的是本地存的分 P 进度。 */
  const [pagePos, setPagePos] = useState<Record<number, number>>({})
  useEffect(() => {
    const prefix = `oh-bilibili:watch-pos:${track.key}:`
    const next: Record<number, number> = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const no = Number(key.slice(prefix.length))
      const at = Number(localStorage.getItem(key) ?? 0)
      if (no > 0 && Number.isFinite(at) && at > 0) next[no] = at
    }
    setPagePos(next)
  }, [track.key, page, data])

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
      const duration = data.duration_ms
      if (duration > 0) savePageLen(track.key, no, duration)
      // 刚切 P 时声音还没起来，进度会短暂为 0；这时不能清掉这一 P 的记录。
      if (at < 5000) return
      if (duration > 0 && at > duration - 10_000) return
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

  /** 长按点赞：把三连补成「都有了」，三项回执都确认后才播放完成动画。 */
  const triple = async (): Promise<void> => {
    if (tripleBusy.current) return
    const key = track.key
    const st = useReactionStore.getState()
    const needLike = !(st.liked[track.key] ?? false)
    const needFav = !(st.faved[track.key] ?? false)
    const haveCoins = st.coins[track.key] ?? 0
    const needCoin = haveCoins < 2
    if (!needLike && !needFav && !needCoin) {
      toastDone('已经三连过了')
      return
    }
    tripleBusy.current = true
    const results: { label: string; ok: boolean }[] = []
    try {
      if (needLike) {
        const next = await st.toggleLike(track)
        results.push({ label: '点赞', ok: next === true })
      } else {
        results.push({ label: '点赞', ok: true })
      }
      if (needCoin) {
        // 一键三连按 B 站语义把硬币补满 2 枚；已经投过 1 枚的只补差额。
        const ok = await st.addCoin(track, 2 - haveCoins, true)
        results.push({ label: '投币', ok })
      } else {
        results.push({ label: '投币', ok: true })
      }
      if (needFav) {
        const next = await st.toggleFav(track)
        results.push({ label: '收藏', ok: next === true })
      } else {
        results.push({ label: '收藏', ok: true })
      }
      if (trackKeyRef.current !== key) return
      const failed = results.filter((item) => !item.ok).map((item) => item.label)
      if (failed.length === 0) {
        if (needLike) setLikeDelta((n) => n + 1)
        if (needCoin) setCoinDelta((n) => n + (2 - haveCoins))
        if (needFav) setFavDelta((n) => n + 1)
        setBurst((n) => n + 1)
        toastDone('一键三连', '点赞、投币、收藏都已确认')
        return
      }
      // 失败可能是服务端拒绝，也可能是回执未知。先以账号关系为准，
      // 避免界面亮着实际没生效，也避免用户重试时重复投币。
      await useReactionStore.getState().refresh([key]).catch(() => {})
      if (trackKeyRef.current !== key) return
      const done = results.filter((item) => item.ok).map((item) => item.label)
      toastWarn(
        `未确认：${failed.join('、')}`,
        done.length > 0 ? `已确认：${done.join('、')}` : '这次没有动作确认成功',
      )
    } finally {
      tripleBusy.current = false
    }
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
  // 按 E 等于点收藏：走同一条路，需要选收藏夹时照样弹窗。
  const openFavRef = useRef(openFav)
  openFavRef.current = openFav
  useEffect(() => {
    setWatchFavHandler(() => openFavRef.current())
    return () => setWatchFavHandler(null)
  }, [])

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
  const danmakuCid = data?.pages.find((entry) => entry.no === currentPageNo)?.cid
  const chapters = metaChapters.map((chapter) => ({ at: chapter.at_ms, title: chapter.title }))
  const pageIndex = data?.pages.findIndex((entry) => entry.no === currentPageNo) ?? -1
  const hasDirectory = data !== null && (data.pages.length > 1 || data.season !== null)
  const directoryLabel = data?.season && data.pages.length > 1 ? '本视频分 P' : '分集'
  const nextPage = pageIndex >= 0 ? data?.pages[pageIndex + 1] ?? null : null
  const session = currentWatchSession(track.key)
  const sessionNext = session ? peekWatchSessionNext(track.key) : null
  // 分 P 播完接下一 P；合集里的单集播完接下一集。B 站两者都是自动连播，
  // 不走相关推荐；片单播放时再往后接片单，片单到最后一条就停下。
  // 只有既没有下一 P、下一集，也不在片单里时才退到推荐第一条。
  const seasonEpisodes = data?.season?.episodes ?? []
  const seasonIndex = seasonEpisodes.findIndex((ep) => ep.key === track.key)
  const nextSeasonEp = seasonIndex >= 0 ? seasonEpisodes[seasonIndex + 1] ?? null : null
  const nextUp: NextUp | null = nextPage
    ? {
        title: nextPage.title || `第 ${nextPage.no} P`,
        owner: track.artist,
        cover: track.cover,
        views: null,
        durationMs: nextPage.duration_ms,
        page: nextPage.no,
      }
    : nextSeasonEp
      ? {
          title: nextSeasonEp.title,
          owner: data?.owner ?? track.artist,
          cover: nextSeasonEp.cover,
          views: nextSeasonEp.views ?? null,
          durationMs: nextSeasonEp.duration_ms || null,
          page: null,
        }
      : session
        ? sessionNext
          ? {
              title: sessionNext.title,
              owner: sessionNext.artist,
              cover: sessionNext.cover,
              views: sessionNext.views ?? null,
              durationMs: sessionNext.duration_ms,
              page: null,
            }
          : null
      : related[0]
      ? {
          title: related[0].title,
          owner: related[0].artist,
          cover: related[0].cover,
          views: related[0].views ?? null,
          durationMs: related[0].duration_ms,
          page: null,
        }
      : null
  const playNext = (): void => {
    if (nextPage) {
      changePage(nextPage.no)
      return
    }
    if (nextSeasonEp) {
      replace({
        kind: 'watch',
        track: {
          key: nextSeasonEp.key,
          title: nextSeasonEp.title,
          artist: '',
          duration_ms: nextSeasonEp.duration_ms || null,
          cover: nextSeasonEp.cover,
          views: nextSeasonEp.views,
        },
      })
      return
    }
    if (session) {
      const next = advanceWatchSession(track.key)
      if (next) replace({ kind: 'watch', track: next })
      return
    }
    const nextRelated = related[0]
    if (nextRelated) replace({ kind: 'watch', track: nextRelated })
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
          if (page !== undefined) saveWatchPage(track.key, page)
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

  /**
   * 片单上下文只在本次观看里有效：换到片单外的视频、或离开观看页就收掉。
   * 分 P 重挂载后仍是同一条视频，不会被误清。
   */
  const [sessionTick, setSessionTick] = useState(0)
  useEffect(() => {
    if (!currentWatchSession(track.key)) endWatchSession()
  }, [track.key, sessionTick])
  useEffect(() => {
    return () => {
      if (useAppStore.getState().view.kind !== 'watch') endWatchSession()
    }
  }, [])

  const skipThis = (): void => {
    const next = skipWatchSession(track.key)
    if (next) {
      replace({ kind: 'watch', track: next })
      return
    }
    endWatchSession()
    setSessionTick((n) => n + 1)
  }

  // 取弹幕。时间轴跟引擎时钟走，画面只是它的跟随者。
  // 多 P 视频的弹幕按 P 分开，cid 没到之前先不拉，免得先闪一屏 P1 的弹幕。
  useEffect(() => {
    setDanmaku([])
    if (!danmakuCid) return
    let cancelled = false
    void ipc
      .danmakuColored(track.key, danmakuCid)
      .then((list) => {
        if (!cancelled) setDanmaku(toDanmakuItems(list))
      })
      .catch(() => setDanmaku([]))
    return () => {
      cancelled = true
    }
  }, [track.key, danmakuCid])

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
      <Modal
        open={pickingPage && data !== null}
        title="选集"
        description={null}
        onClose={() => setPickingPage(false)}
        width="max-w-lg"
      >
        {data ? (
          <>
            {data.pages.length > 1 ? (
              <PageList
                bare
                title={directoryLabel}
                pages={data.pages}
                current={currentPageNo}
                onPage={(no) => {
                  setPickingPage(false)
                  changePage(no)
                }}
                progress={pagePos}
              />
            ) : null}
            {data.season ? <SeasonList bare season={data.season} /> : null}
          </>
        ) : null}
      </Modal>
      {/* 返回在顶栏（TitleBar），不在画面上：浮在视频角上会挡住画面内容。 */}
      {/* 左画面右推荐的布局：视频客户端的信息骨架，音乐播放器那套单列竖排不适用。 */}
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
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
          {!cinema && session ? (
            <div
              data-watch-session
              className="mb-2 flex min-w-0 items-center gap-2 text-[12.5px] leading-[18px] text-[var(--text-2)]"
            >
              <span className="num shrink-0">
                {session.label} {session.index + 1}/{session.items.length}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--text-3)]">
                {sessionNext ? `下一条《${sessionNext.title}》` : '最后一条'}
              </span>
              <button
                type="button"
                onClick={() => {
                  endWatchSession()
                  setSessionTick((n) => n + 1)
                }}
                className="t shrink-0 text-[var(--text-3)] hover:text-[var(--text-1)]"
              >
                退出片单
              </button>
            </div>
          ) : null}
          {!cinema && data ? (
            <WatchHead
              track={track}
              data={data}
              currentPage={currentPageNo}
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
                online={online}
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
                nextUp={nextUp}
                onNext={playNext}
                seekSignal={seekSignal}
                noteSeek={noteSeek}
                onNoteSeekDone={() => setNoteSeek(null)}
                currentPage={currentPageNo}
                onPage={changePage}
                resumeAt={resume?.key === track.key ? resume.at : null}
                chapters={chapters}
              />
            </div>
          ) : (
            <div className="aspect-video w-full shrink-0 bg-black" />
          )}
          {!cinema && data && hasDirectory ? (
            <div className="border-b border-hairline xl:hidden">
              <button
                ref={pageTriggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={pickingPage}
                onClick={() => setPickingPage(true)}
                className="t press flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-[var(--text-2)] hover:text-[var(--text-1)]"
              >
                <Icon name="queue" size={14} className="shrink-0 text-[var(--text-3)]" />
                <span className="min-w-0 flex-1 truncate">{directoryTitle(data, page ?? data.current_page)}</span>
                <Icon name="chevronRight" size={13} className="shrink-0 rotate-90 text-[var(--text-3)]" />
              </button>
            </div>
          ) : null}
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
              {session ? (
                <button type="button" onClick={skipThis} className="t shrink-0 text-[var(--text-3)] hover:text-[var(--text-1)]">
                  跳过
                </button>
              ) : null}
            </div>
          ) : null}
          {!cinema && data ? (
            <WatchInfo
              track={track}
              data={data}
              currentPage={currentPageNo}
              likeDelta={likeDelta}
              favDelta={favDelta}
              coinDelta={coinDelta}
              onCoin={coin}
              onLike={like}
              onFav={openFav}
              onTriple={triple}
              onSeek={seekTo}
              ownerRow={
                <div className="xl:hidden">
                  <OwnerCard
                    data={data}
                    card={card}
                    followed={followed}
                    fansDelta={fansDelta}
                    onFollow={toggleFollow}
                    inline
                  />
                </div>
              }
            />
          ) : null}
          {!cinema && danmaku.length > 0 ? (
            <div className="border-t border-hairline xl:hidden">
              <DanmakuList items={danmaku} />
            </div>
          ) : null}
          {!cinema && data ? (
            <div className="border-t border-hairline xl:hidden">
              <ChapterList
                desc={data.desc}
                chapters={chapters}
                onSeek={seekTo}
                title={hasDirectory ? '本集章节' : '章节'}
              />
            </div>
          ) : null}
          {/* 右栏在窄屏收起，推荐改到评论区上方，否则手机上看完这条就没有下一个可点。 */}
          {!cinema ? (
            <div data-watch-inline className="border-t border-hairline xl:hidden">
              <RelatedAside items={related} />
            </div>
          ) : null}
          {!cinema ? (
            <div className="border-t border-hairline">
              <CommentsPanel
                trackKey={track.key}
                ownerMid={data?.owner_mid ?? null}
                pages={data?.pages ?? []}
                onSeek={seekFromComment}
                flow
              />
            </div>
          ) : null}
        </div>

        {!cinema ? (
          <aside
            data-watch-rail
            className="hidden min-h-0 w-[var(--rail-w)] shrink-0 overflow-y-auto border-l border-hairline xl:block"
          >
            {/* 目录贴住视频顶边：连续看教程时先找「在放哪一集」，再关心别的。 */}
            {data && data.pages.length > 1 ? (
              <PageList
                title={directoryLabel}
                pages={data.pages}
                current={currentPageNo}
                onPage={changePage}
                progress={pagePos}
              />
            ) : null}
            {data?.season ? <SeasonList season={data.season} /> : null}
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
            {data ? (
              <ChapterList
                desc={data.desc}
                chapters={chapters}
                onSeek={seekTo}
                title={hasDirectory ? '本集章节' : '章节'}
              />
            ) : null}
            <RelatedAside items={related} />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
