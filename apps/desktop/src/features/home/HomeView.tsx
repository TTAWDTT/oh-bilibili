import { TrackByline } from '../tracks/TrackByline'
import { TrackDirectory } from '../tracks/TrackDirectory'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { useAppStore } from '../../app/appStore'
import { PARTS } from '../../shared/lib/biliParts'
import { HeroBanner } from './HeroBanner'
import { HeroQuoteLine, useHeroQuote } from './HeroQuote'
import { LiveRow } from './LiveRow'
import { BangumiRow } from './BangumiRow'
import { PartitionRow } from './PartitionRow'
import { RegionFeed, regionMemory } from './RegionFeed'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { Cover } from '../../shared/ui/Cover'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { ResumeCard, resumeFrom, type Resume } from './ResumeCard'

const PARTITION_FLOORS = [
  { rid: 1, title: '动画' },
  { rid: 3, title: '音乐' },
  { rid: 4, title: '游戏' },
]

/** 首页推荐等这么久还没回来就提示「加载较慢」，但请求继续等，不提前判死。 */
const FEED_SLOW_MS = 8000

/**
 * 发现页。
 *
 * 推荐接口是全站风控最严的一处，所以取数节奏跟着用户走：
 * 首屏 12 条，滚到底再取下一批（fresh_idx 递增），不后台预取。
 * 被拒时给明确文案和「换一批」，不假装有内容。
 */

/** 按会话记住这一屏：从视频页返回时，推荐流和滚动位置都要原样回来。 */
const feedMemory: {
  items: Track[]
  resume: Resume | null
  /** 首屏那十一条（轮播 5 + 右侧 6）。它可以被「换一换」单独换掉，下面推荐流不动。 */
  hero: Track[]
  fresh: number
  nextFresh: number
  scrollTop: number
  index: number
} = {
  items: [],
  resume: null,
  hero: [],
  fresh: 1,
  nextFresh: 2,
  scrollTop: 0,
  index: 0,
}
export function HomeView() {
  const navigate = useAppStore((s) => s.navigate)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const playContext = usePlayerStore((s) => s.playContext)
  const scope = useAppStore((state) => state.view.kind === 'home' ? (state.view.rid ?? 0) : 0)
  const replace = useAppStore((state) => state.replace)
  const [items, setItems] = useState<Track[]>(feedMemory.items)
  const [hero, setHero] = useState<Track[]>(feedMemory.hero)
  const [wideHero, setWideHero] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [heroLoading, setHeroLoading] = useState(false)
  // 从分 P 目录或首推返回时保留原卡位，新产生的观看历史不应把焦点目标顶走。
  const keepLayout = useRef(/^(directory|hero|hero-quote|hero-author|herocard):/.test(useAppStore.getState().returnFocus?.id ?? '')).current
  const [resume, setResume] = useState<Resume | null>(keepLayout ? feedMemory.resume : null)
  // 续播位独立于推荐：换推荐不能动它，推荐失败也不影响它。
  useEffect(() => {
    if (keepLayout) return
    feedMemory.resume = null
    let alive = true
    void ipc
      .libraryHistoryTimed(12)
      .then(async (list) => {
        if (!alive) return
        const next = resumeFrom(list)
        feedMemory.resume = next
        setResume(next)
        if (!next?.page) return
        const meta = await ipc.videoMeta(next.entry.track.key)
        const partTitle = meta.pages.find((part) => part.no === next.page)?.title.trim()
        if (alive && partTitle && partTitle !== next.entry.track.title) {
          feedMemory.resume = { ...next, partTitle }
          setResume(feedMemory.resume)
        }
      })
      .catch(() => {
        // 历史和分 P 名称分别到达；详情失败时仍可用现有断点续播。
      })
    return () => {
      alive = false
    }
  }, [keepLayout])

  const openResume = (item: Resume): void => {
    if (item.watching) {
      // 观看页自己会从本地记录恢复到分 P 与位置。
      navigate({ kind: 'watch', track: item.entry.track }, undefined, `resume:${item.entry.track.key}`)
      return
    }
    void playContext([item.entry.track.key], 0).then(() => {
      void usePlayerStore.getState().seek(item.position)
    })
  }
  /** 当前这批曲目的镜像。去重要在 setState 之外算，不然「新增了几条」永远是旧值。 */
  const itemsRef = useRef<Track[]>(feedMemory.items)
  const heroRef = useRef<Track[]>(feedMemory.hero)
  const [fresh, setFresh] = useState(feedMemory.fresh)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [slow, setSlow] = useState(false)
  /** 上次失败是网络抖动：只有这种情况才给「重试」，到底了给的是「换一批」。 */
  const [canRetry, setCanRetry] = useState(false)
  /** 下一批的 fresh_idx。接口按它返回「另一批」，同值重复取会拿到一样的。 */
  const nextFresh = useRef(feedMemory.nextFresh)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** 滚动事件比 React 状态回写快，用它挡住同一批的重复请求。 */
  const pending = useRef(false)
  /** 每次尝试的自增编号：只有最新一次的成功或失败能落到界面上。 */
  const requestSeq = useRef(0)
  const slowTimer = useRef<number | null>(null)
  /** 最近一次尝试的参数，手动重试时原样再发一次。 */
  const attempt = useRef({ next: 1, append: false })
  /** 上一批一条新的都没带回来，就说明推荐流到头了，别再自动补。 */
  const exhausted = useRef(false)
  /** 频道条只在真的横向溢出时才给渐隐：滚到两端时不能还遮住首尾胶囊。 */
  const channelRef = useRef<HTMLDivElement | null>(null)
  const [channelFade, setChannelFade] = useState({ left: false, right: false })

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const sync = (): void => setWideHero(media.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const el = channelRef.current
    if (!el) return
    const update = (): void => {
      const left = el.scrollLeft > 1
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setChannelFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])

  const resumeKey = resume?.entry.track.key ?? null
  /** 续播那一条不再出现在推荐里，宽窄窗都一样。 */
  const heroPool = resumeKey ? hero.filter((track) => track.key !== resumeKey) : hero
  /** 续播卡占了轮播的位置时，右边从推荐第一批的开头取六张，剩下的接进下方推荐流。 */
  const heroCards = resume ? heroPool.slice(0, 6) : heroPool.slice(5, 11)
  /** 续播卡占左列时，右侧第一张就是首推；它才是唯一要补弹幕引文的那张。 */
  const featuredQuote = useHeroQuote(resume && wideHero ? heroCards[0]?.key : undefined)
  const heroKeys = new Set(hero.map((track) => track.key))
  const cardKeys = new Set(heroCards.map((track) => track.key))
  const feedRemainder = items.filter((track) => !heroKeys.has(track.key) && track.key !== resumeKey)
  const feedTracks = wideHero
    ? resume
      ? [
          ...new Map(
            [
              ...heroPool.slice(6),
              ...items.filter((track) => !cardKeys.has(track.key) && track.key !== resumeKey),
            ].map((track) => [track.key, track]),
          ).values(),
        ]
      : feedRemainder
    : [...new Map([...heroPool.slice(5), ...feedRemainder].map((track) => [track.key, track])).values()]

  const load = useCallback(async (next: number, append = false): Promise<void> => {
    attempt.current = { next, append }
    const ticket = ++requestSeq.current
    pending.current = append
    if (slowTimer.current !== null) window.clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => {
      if (requestSeq.current === ticket) setSlow(true)
    }, FEED_SLOW_MS)
    setSlow(false)
    setLoading(!append)
    setLoadingMore(append)
    setError(null)
    try {
      const list = await ipc.homeFeed(next)
      if (requestSeq.current !== ticket) return
      // 成功才推进：失败就留在这一页，重试时不会再跳过一个 fresh_idx。
      if (append) {
        nextFresh.current = next + 1
        feedMemory.nextFresh = next + 1
      }
      setCanRetry(false)
      // 推荐流会重复推同一条，按 key 去重后再追加。
      const base = append ? itemsRef.current : []
      const seen = new Set(base.map((t) => t.key))
      const fresh = append ? list.filter((t) => !seen.has(t.key)) : list
      // 整批都是见过的：继续取只会原地打转，而且新数组会让预取 effect 再跑一轮。
      if (append && fresh.length === 0) {
        exhausted.current = true
        setError('这一轮的推荐已经到底了，换一批看看。')
        return
      }
      const merged = [...base, ...fresh]
      itemsRef.current = merged
      setItems(merged)
      // 首屏那十一条跟着第一页走；之后翻页只往推荐流里加，不动顶部。
      if (!append) {
        const top = merged.slice(0, 11)
        heroRef.current = top
        setHero(top)
      }
      if (list.length === 0) {
        if (append) exhausted.current = true
        setError(append ? '这一轮的推荐已经到底了，换一批看看。' : '这次没拿到推荐，换一批试试。')
      }
    } catch (e) {
      if (requestSeq.current !== ticket) return
      setError(toWireError(e).message)
      setCanRetry(true)
    } finally {
      if (requestSeq.current === ticket) {
        if (slowTimer.current !== null) {
          window.clearTimeout(slowTimer.current)
          slowTimer.current = null
        }
        setSlow(false)
        pending.current = false
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    }
  }, [])

  useEffect(
    () => () => {
      if (slowTimer.current !== null) window.clearTimeout(slowTimer.current)
    },
    [],
  )

  useEffect(() => {
    nextFresh.current = feedMemory.nextFresh
    if (feedMemory.items.length === 0) void load(1)
  }, [load])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = scope === 0 ? feedMemory.scrollTop : regionMemory.get(scope)?.top ?? 0
  }, [scope])

  useEffect(() => {
    feedMemory.items = items
  }, [items])

  useEffect(() => {
    feedMemory.hero = hero
  }, [hero])

  useEffect(() => {
    feedMemory.fresh = fresh
  }, [fresh])

  const chooseScope = (rid: number): void => {
    if (rid === scope) return
    regionMemory.delete(rid)
    replace(rid ? { kind: 'home', rid } : { kind: 'home' })
  }

  const more = (): void => {
    // 到底了就不再请求：滚动事件会一直触发，不挡住就是无限空请求。
    if (pending.current || loading || loadingMore || exhausted.current) return
    void load(nextFresh.current, true)
  }

  /**
   * 轮播右侧那颗「换一换」只换首屏那十一条：换一个 fresh_idx 取一页，
   * 把新的一页里推荐流还没出现过、也不在旧首屏里的条目挑出来补进顶部。
   * 下面的推荐流、滚动位置都不动——B 站这颗按钮也只作用于上面那一块。
   */
  const refreshHero = async (): Promise<void> => {
    if (heroLoading) return
    setHeroLoading(true)
    const next = fresh + 1
    setFresh(next)
    try {
      const list = await ipc.homeFeed(next)
      // 只跟当前首屏比：拿整条推荐流去重的话，划得越深新一页被筛掉的越多，
      // 最后换一换一颗也不换。
      const shown = new Set(heroRef.current.map((t) => t.key))
      const swapped = list.filter((t) => !shown.has(t.key)).slice(0, 11)
      if (swapped.length > 0) {
        heroRef.current = swapped
        feedMemory.hero = swapped
        setHero(swapped)
      }
    } catch {
      // 换失败就保留当前首屏，不把已经能看的内容清空。
    } finally {
      setHeroLoading(false)
    }
  }

  /** 列表末尾的「换一批」才是换整页：连推荐流一起重来，并回到顶部。 */
  const refreshAll = (): void => {
    const next = fresh + 1
    scrollerRef.current?.scrollTo({ top: 0 })
    itemsRef.current = []
    heroRef.current = []
    setFresh(next)
    nextFresh.current = 2
    feedMemory.nextFresh = 2
    feedMemory.scrollTop = 0
    feedMemory.index = 0
    exhausted.current = false
    void load(next)
  }

  const retrySlow = (): void => {
    void load(attempt.current.next, attempt.current.append)
  }

  const slowNotice = slow ? (
    <div data-home-slow className="flex flex-col items-center gap-2 py-4">
      <p className="text-center text-[12.5px] text-[var(--text-3)]">加载较慢，可能网络不太好。</p>
      <button
        type="button"
        data-home-retry
        onClick={retrySlow}
        className="t press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[12.5px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        重试
      </button>
    </div>
  ) : null

  return (
    <div
      ref={scrollerRef}
      id="scroll-main"
      onScroll={(event) => {
        const el = event.currentTarget
        // 分区里的滚动不是推荐流的位置，别把它写进返回时要用的记忆。
        if (scope !== 0) {
          const region = regionMemory.get(scope)
          if (region) region.top = el.scrollTop
          return
        }
        feedMemory.scrollTop = el.scrollTop
        const max = el.scrollHeight - el.clientHeight
        // 滚动高度只覆盖已挂出来的卡片，比例要按渲染窗口算，不能按取回的条数算。
        const rendered = Number(el.querySelector<HTMLElement>('[data-shown]')?.dataset.shown ?? 0)
        if (max > 0 && rendered > 1) {
          feedMemory.index = Math.round((el.scrollTop / max) * (rendered - 1))
        }
      }}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto py-0 px-0 pb-10 md:px-0"
    >
      {/*
       * 频道条照 B 站首页：左边两颗圆形入口，右边一排窄胶囊。
       * B 站胶囊实测 #f6f7f8、无描边、深色字、28 高、宽约 60——一格只放得下两个分区名。
       * 之前把 12 个胶囊拉成 6 列网格、每格 100 宽，整条带子像一组表单输入框；
       * 右侧那块快捷入口又和左栏完全重复，删掉后 12 个胶囊正好一行排完。
       */}
      <nav className="mb-4 bg-[var(--panel)] py-3">
        <div className="flex items-center gap-5 px-4 md:px-8">
          {/* 宽窗左栏已经有热门/排行榜，这里只留给窄窗的可发现入口。 */}
          <div className="flex shrink-0 items-start gap-3 md:hidden">
            {[
              { label: '热门', icon: 'flame' as const, tone: '#ff7a45', run: () => navigate({ kind: 'popular' }) },
              { label: '排行', icon: 'rank' as const, tone: 'var(--accent)', run: () => navigate({ kind: 'ranking' }) },
            ].map((entry) => (
              <button
                key={entry.label}
                type="button"
                onClick={entry.run}
                /* 不写固定宽度：按钮宽 = 圆形直径，圆的左缘就和下面胶囊、轮播、卡片同一条线。 */
                className="t press flex w-10 flex-col items-center gap-1 rounded-[8px] py-0.5 text-[12px] text-[var(--text-2)] hover:text-[var(--text-1)]"
              >
                <span
                  className="bili-channel-icon flex h-10 w-10 items-center justify-center rounded-full text-white"
                  style={{ background: entry.tone }}
                >
                  <Icon name={entry.icon} size={18} />
                </span>
                <span className="whitespace-nowrap">{entry.label}</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div
              ref={channelRef}
              className={`no-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto border-l border-[var(--line)] pl-5 ${
                channelFade.left && channelFade.right
                  ? 'bili-channels-fade-lr'
                  : channelFade.right
                    ? 'bili-channels-fade-r'
                    : channelFade.left
                      ? 'bili-channels-fade-l'
                      : ''
              }`}
            >
              <button
                type="button"
                aria-pressed={scope === 0}
                onClick={() => chooseScope(0)}
                className={[
                  't h-7 w-[62px] shrink-0 rounded-[4px] text-[12.5px]',
                  scope === 0
                    ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                    : 'bg-[var(--ga0)] text-[var(--text-1)] hover:bg-[var(--line)] hover:text-[var(--accent)]',
                ].join(' ')}
              >
                全部
              </button>
              {PARTS.filter((part) => part.rid !== 0).map((part) => (
                <button
                  key={part.rid}
                  type="button"
                  aria-pressed={scope === part.rid}
                  onClick={() => chooseScope(part.rid)}
                  className={[
                    't h-7 w-[62px] shrink-0 rounded-[4px] text-[12.5px]',
                    scope === part.rid
                      ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                      : 'bg-[var(--ga0)] text-[var(--text-1)] hover:bg-[var(--line)] hover:text-[var(--accent)]',
                  ].join(' ')}
                >
                  {part.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* 首屏没内容才把错误摆在顶部；已经有一屏推荐时，这句话属于列表末尾。 */}
      {scope === 0 && error && items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-[13px] text-[var(--text-3)]">{error}</p>
          <button
            type="button"
            onClick={refreshAll}
            className="t press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[12.5px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            重新取一次
          </button>
        </div>
      ) : null}
      {scope === 0 && slow && !attempt.current.append ? slowNotice : null}

      {scope === 0 && resume && !wideHero ? (
        <div className="px-4 pt-4 md:px-8 lg:hidden">
          <ResumeCard compact resume={resume} onOpen={openResume} />
        </div>
      ) : null}

      {/* 推荐单独失败时，续播卡不跟着消失。 */}
      {scope === 0 && resume && wideHero && hero.length === 0 ? (
        <div className="px-4 pt-4 md:px-8">
          <div className="hidden max-w-[560px] lg:block">
            <ResumeCard resume={resume} onOpen={openResume} />
          </div>
        </div>
      ) : null}

      {/*
       * B 站首页首屏是「大轮播 + 右侧卡片网格」：右侧给四张带封面的卡，
       * 而不是一列文字条目。轮播用前 5 条、右栏接 6 条，下面网格从第 11 条开始，
       * 同一批推荐不会在屏上出现两次。
       */}
      {scope === 0 && hero.length > 0 ? (
        <div data-home-recommend className="mb-4 px-4 pt-4 md:px-8">
          {/* 标题行给「换一换」一个和内容左右对齐的落点。之前是贴在右边缘的一整条竖卡，
              宽度顶出内容区，整页就多出一条横向滚动条。 */}
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-[17px] font-medium text-[var(--text-1)]">推荐</h2>
            <button
              type="button"
              onClick={() => void refreshHero()}
              disabled={heroLoading}
              className="t press flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12.5px] text-[var(--text-3)] hover:bg-[var(--ga0)] hover:text-[var(--accent)] disabled:pointer-events-none"
            >
              <Icon name="refresh" size={13} className={heroLoading ? 'animate-spin' : ''} />
              换一换
            </button>
          </div>
          {/*
           * B 站 1280 视口实测：轮播约占内容宽 44%，右侧是 3 列 × 2 行六张 16:9 小卡。
           * 45/55 下右栏每张约 186 宽，轮播 7:5 与两行卡片正好等高，不用给哪一边留空。
           */}
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
          {resume && wideHero ? (
            <div className="hidden lg:block">
              <ResumeCard resume={resume} onOpen={openResume} />
            </div>
          ) : (
            <HeroBanner
              tracks={heroPool.slice(0, 5)}
              onOpen={(track, start) =>
                navigate(
                  start
                    ? { kind: 'watch', track, page: start.page, atMs: start.atMs }
                    : { kind: 'watch', track },
                  undefined,
                  `${start ? 'hero-quote' : 'hero'}:${track.key}`,
                )
              }
            />
          )}
          {(resume ? heroCards.length > 0 : hero.length > 5) && wideHero ? (
            /* key 绑首条：换一换之后 key 变，整块重挂载，淡入从第一帧开始。 */
            <div key={heroCards[0]?.key} data-home-hero-grid className="bili-hero-swap grid grid-cols-3 gap-3">
              {heroCards.map((track, i) => (
                <div key={track.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'watch', track }, undefined, `herocard:${track.key}`)}
                  data-focus-id={`herocard:${track.key}`}
                  className="bili-card group block w-full min-w-0 text-left"
                >
                  <span className="relative block aspect-video overflow-hidden rounded-[6px]">
                    <Cover cover={track.cover} title={track.title} width={220} className="h-full w-full" />
                    {/* 左下角播放/弹幕两枚计数、右下角时长：跟下面推荐流同一套压角规则。 */}
                    <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-1 text-[12px] leading-[15px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
                      <span className="num flex min-w-0 items-center gap-1">
                        {track.views ? (
                          <>
                            <Icon name="play" size={10} className="shrink-0" />
                            <span className="truncate">{formatCount(track.views)}</span>
                          </>
                        ) : null}
                        {(track.danmaku ?? 0) > 0 ? (
                          <>
                            <Icon name="danmaku" size={11} className="ml-0.5 shrink-0" />
                            <span className="truncate">{formatCount(track.danmaku!)}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="num shrink-0 rounded-[2px] bg-black/60 px-1 [text-shadow:none]">
                        {formatDuration(track.duration_ms)}
                      </span>
                    </span>
                  </span>
                  {/* B 站首屏这几张比推荐流小一档：宽只有 186，15px 两行标题会顶到封面。 */}
                  <span className="mt-1.5 line-clamp-2 text-[13.5px] leading-[19px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                    {track.title}
                  </span>
                </button>
                <TrackDirectory track={track} sourceId={`herocard:${track.key}`} />
                <div className="mt-1 text-[12px] text-[var(--text-3)]">
                  <TrackByline track={track} focusId={`hero-author:${track.key}`} />
                </div>
                {i === 0 && featuredQuote ? (
                  <HeroQuoteLine
                    track={track}
                    quote={featuredQuote}
                    onOpen={(target, start) =>
                      navigate(
                        { kind: 'watch', track: target, page: start.page, atMs: start.atMs },
                        undefined,
                        `hero-quote:${target.key}`,
                      )
                    }
                  />
                ) : null}
                </div>
              ))}
            </div>
          ) : null}
          </div>
        </div>
      ) : null}

      {scope !== 0 ? (
        <RegionFeed key={scope} rid={scope} activeKey={activeKey} playing={playing} />
      ) : (
        <>
          {/* 直播与番剧紧贴首屏：放在无限推荐流后面等于永远看不到，推荐流本身没有底 */}
          <LiveRow />
          <BangumiRow />
          {PARTITION_FLOORS.map((part) => (
            <PartitionRow key={part.rid} rid={part.rid} title={part.title} />
          ))}
        </>
      )}

      {scope === 0 && items.length > 0 ? (
        <div data-home-feed className="px-4 md:px-8">
          <ContentGrid
            tracks={feedTracks}
            activeKey={activeKey}
            playing={playing}
            onNeedMore={more}
            lookahead={600}
            initialIndex={feedMemory.index}
          />
        </div>
      ) : null}
      {scope === 0 && loading && items.length === 0 ? <BiliLoader label="正在取推荐…" /> : null}
      {scope === 0 && loadingMore ? <BiliLoader compact label="正在加载更多…" /> : null}
      {scope === 0 && slow && attempt.current.append ? slowNotice : null}
      {scope === 0 && error && items.length > 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-center text-[12.5px] text-[var(--text-3)]">{error}</p>
          <button
            type="button"
            onClick={canRetry ? more : refreshAll}
            className="t press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[12.5px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {canRetry ? '重试这一页' : '换一批'}
          </button>
        </div>
      ) : null}
      {/* 站脚：B 站首页最底下那句老口号，是这个站最好认的一行字。 */}
      <p className="py-8 text-center text-[12px] tracking-wide text-[var(--text-3)]">
        哔哩哔哩 (゜-゜)つロ 干杯~
      </p>
    </div>
  )
}
