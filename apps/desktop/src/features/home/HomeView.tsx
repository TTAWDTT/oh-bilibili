import { TrackByline } from '../tracks/TrackByline'
import { TrackDirectory } from '../tracks/TrackDirectory'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { useAppStore } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import { DISCOVERY_REGIONS } from '../../shared/lib/discoveryRegions'
import { DiscoveryNavigation } from './DiscoveryNavigation'
import { discoveryTabKey, useDiscoveryTabs } from './discoveryTabs'
import { FeedMoreButton } from './FeedMoreButton'
import './discovery.css'
import { HeroBanner } from './HeroBanner'
import { RegionFeed, regionMemory } from './RegionFeed'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { Cover } from '../../shared/ui/Cover'
import { formatCount, formatDuration } from '../../shared/lib/format'
/** 首页推荐等这么久还没回来就提示「加载较慢」，但请求继续等，不提前判死。 */
const FEED_SLOW_MS = 8000

/**
 * 发现页。
 *
 * 推荐接口是全站风控最严的一处，所以取数节奏跟着用户走：
 * 靠近列表底部时才取下一批（fresh_idx 递增）。
 * 被拒时给明确文案和「换一批」，不假装有内容。
 */

/** 按会话记住这一屏：从视频页返回时，推荐流和滚动位置都要原样回来。 */
const feedMemory: {
  items: Track[]
  /** 首屏那十一条（轮播 5 + 右侧 6）。它可以被「换一换」单独换掉，下面推荐流不动。 */
  hero: Track[]
  nextFresh: number
  top: number
  index: number
} = {
  items: [],
  hero: [],
  nextFresh: 2,
  top: 0,
  index: 0,
}
export function HomeView() {
  const navigate = useAppStore((s) => s.navigate)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const channel = useAppStore((state) => state.view.kind === 'home' ? state.view.channel : undefined)
  const [catalog, setCatalog] = useState(DISCOVERY_REGIONS)
  const { tabs, saveTabs } = useDiscoveryTabs(catalog)
  const selected = catalog.find((tab) => discoveryTabKey(tab) === channel)
  const scope = selected && discoveryTabKey(selected)
  const replace = useAppStore((state) => state.replace)
  const [items, setItems] = useState<Track[]>(feedMemory.items)
  const [hero, setHero] = useState<Track[]>(feedMemory.hero)
  const [wideHero, setWideHero] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [heroLoading, setHeroLoading] = useState(false)
  /** 当前这批曲目的镜像。去重要在 setState 之外算，不然「新增了几条」永远是旧值。 */
  const itemsRef = useRef<Track[]>(feedMemory.items)
  const heroRef = useRef<Track[]>(feedMemory.hero)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [slow, setSlow] = useState(false)
  /** 上次失败是网络抖动：只有这种情况才给「重试」，到底了给的是「换一批」。 */
  const [canRetry, setCanRetry] = useState(false)
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
  useEffect(() => {
    void ipc.discoveryRegions().then(setCatalog).catch(() => {})
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const sync = (): void => setWideHero(media.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const topCount = 5 + (wideHero ? 6 : 2)
  const heroCards = hero.slice(5, topCount)
  const topKeys = new Set(hero.slice(0, topCount).map((track) => track.key))
  const feedTracks = [...new Map([
    ...hero.slice(topCount),
    ...items.filter((track) => !topKeys.has(track.key)),
  ].map((track) => [track.key, track])).values()]

  const load = useCallback(async (next: number, append = false): Promise<void> => {
    attempt.current = { next, append }
    const ticket = ++requestSeq.current
    pending.current = true
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
      setCanRetry(false)
      // 推荐流会重复推同一条，按 key 去重后再追加。
      const base = append ? itemsRef.current : []
      const seen = new Set(base.map((t) => t.key))
      const fresh = list.filter((track) => {
        if (seen.has(track.key)) return false
        seen.add(track.key)
        return true
      })
      // 整批都见过时停止自动翻页，等用户主动换一批。
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
      if (!merged.length) setError('这次没拿到推荐，换一批试试。')
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
      ++requestSeq.current
      pending.current = false
      if (slowTimer.current !== null) window.clearTimeout(slowTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (!scope && !itemsRef.current.length && !pending.current) void load(1)
  }, [scope, load])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = scope ? regionMemory.get(scope)?.top ?? 0 : feedMemory.top
  }, [scope])

  useEffect(() => {
    feedMemory.items = items
  }, [items])

  useEffect(() => {
    feedMemory.hero = hero
  }, [hero])

  const chooseScope = (key?: string): void => {
    if (scope !== key) replace(key ? { kind: 'home', channel: key } : { kind: 'home' })
  }

  const more = (): void => {
    // 到底了就不再请求：滚动事件会一直触发，不挡住就是无限空请求。
    if (pending.current || exhausted.current) return
    void load(feedMemory.nextFresh++, true)
  }

  /**
   * 轮播右侧那颗「换一换」只换首屏那十一条：换一个 fresh_idx 取一页，
   * 从中挑出与当前首屏不同的投稿，下方已取回的推荐继续保留。
   */
  const refreshHero = async (): Promise<void> => {
    if (heroLoading) return
    setHeroLoading(true)
    scrollerRef.current?.scrollTo({ top: 0 })
    const next = feedMemory.nextFresh++
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
      } else {
        useAppStore.getState().pushToast('info', '暂时没有新推荐', null)
      }
    } catch (cause) {
      toastFailure('换推荐', cause)
    } finally {
      setHeroLoading(false)
    }
  }

  /** 列表末尾的「换一批」才是换整页：连推荐流一起重来，并回到顶部。 */
  const refreshAll = (): void => {
    const next = feedMemory.nextFresh++
    scrollerRef.current?.scrollTo({ top: 0 })
    itemsRef.current = []
    heroRef.current = []
    feedMemory.top = 0
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
        const memory = scope ? regionMemory.get(scope) : feedMemory
        if (!memory) return
        memory.top = el.scrollTop
        const max = el.scrollHeight - el.clientHeight
        const rendered = Number(el.querySelector<HTMLElement>('[data-shown]')?.dataset.shown ?? 0)
        if (max > 0 && rendered > 1) {
          memory.index = Math.round((el.scrollTop / max) * (rendered - 1))
        }
      }}
      className="discovery-page min-h-0 flex-1 overflow-y-auto pb-10"
    >
      <header className="discovery-bar">
        <h1 className="sr-only">发现</h1>
        <DiscoveryNavigation catalog={catalog} tabs={tabs} selected={selected} onSave={saveTabs}
          onSelect={(region) => chooseScope(region && discoveryTabKey(region))} />
        <div className="discovery-shortcuts md:hidden">
          <button type="button" title="热门" aria-label="热门" onClick={() => navigate({ kind: 'popular' })}>
            <Icon name="popularFlame" size={20} /><span>热门</span>
          </button>
          <button type="button" title="排行" aria-label="排行" onClick={() => navigate({ kind: 'ranking' })}>
            <Icon name="rankRosette" size={20} /><span>排行</span>
          </button>
        </div>
        {!scope && hero.length > 0 && (
          <button type="button" aria-label="换一换" title="换一换" onClick={() => void refreshHero()} disabled={heroLoading}
            className="discovery-refresh t press disabled:pointer-events-none">
            <Icon name="refresh" size={14} className={heroLoading ? 'animate-spin' : ''} />
            <span>换一换</span>
          </button>
        )}
      </header>

      {/* 首屏没内容才把错误摆在顶部；已经有一屏推荐时，这句话属于列表末尾。 */}
      {!scope && error && items.length === 0 ? (
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
      {!scope && slow && !attempt.current.append ? slowNotice : null}

      {!scope && hero.length > 0 ? (
        <div data-home-recommend className="discovery-recommend px-4 md:px-8">
          <h2 className="sr-only">推荐</h2>
          <div className="discovery-lead-grid">
            <HeroBanner
              tracks={hero.slice(0, 5)}
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
          {heroCards.length > 0 ? (
            /* key 绑首条：换一换之后 key 变，整块重挂载，淡入从第一帧开始。 */
            <div key={heroCards[0]?.key} data-home-hero-grid className="discovery-picks bili-hero-swap">
              {heroCards.map((track) => (
                <div key={track.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'watch', track }, undefined, `herocard:${track.key}`)}
                  data-focus-id={`herocard:${track.key}`}
                  className="bili-card group block w-full min-w-0 text-left"
                >
                  <span className="relative block aspect-video overflow-hidden rounded-[8px]">
                    <Cover cover={track.cover} title={track.title} width={360} className="h-full w-full" />
                    {/* 左下角播放/弹幕两枚计数、右下角时长：跟下面推荐流同一套压角规则。 */}
                    <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-3 text-[12px] leading-[15px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
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
                  <span className="mt-2 line-clamp-2 text-[14px] font-medium leading-5 text-[var(--text-1)] group-hover:text-[var(--accent)]">
                    {track.title}
                  </span>
                </button>
                <TrackDirectory track={track} sourceId={`herocard:${track.key}`} />
                <div className="mt-1 text-[12px] text-[var(--text-3)]">
                  <TrackByline track={track} focusId={`hero-author:${track.key}`} />
                </div>
                </div>
              ))}
            </div>
          ) : null}
          </div>
        </div>
      ) : null}

      {selected && scope && (
        <RegionFeed key={scope} tab={selected}
          activeKey={activeKey} playing={playing} />
      )}

      {!scope && items.length > 0 ? (
        <div data-home-feed className="mt-6 px-4 md:px-8">
          <h2 className="sr-only">更多推荐</h2>
          <ContentGrid
            tracks={feedTracks}
            activeKey={activeKey}
            playing={playing}
            initialIndex={feedMemory.index}
          />
          {!loading && !loadingMore && !error && <FeedMoreButton onMore={more} />}
        </div>
      ) : null}
      {!scope && loading && items.length === 0 ? <BiliLoader label="正在取推荐…" /> : null}
      {!scope && loadingMore ? <BiliLoader compact label="正在加载更多…" /> : null}
      {!scope && slow && attempt.current.append ? slowNotice : null}
      {!scope && error && items.length > 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-center text-[12.5px] text-[var(--text-3)]">{error}</p>
          <button
            type="button"
            onClick={canRetry ? retrySlow : refreshAll}
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
