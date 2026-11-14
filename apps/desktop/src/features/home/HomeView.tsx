import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { ContentGrid } from '../tracks/ContentGrid'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { usePlayerStore } from '../player/playerStore'
import { useAppStore } from '../../app/appStore'
import { PARTS } from '../../shared/lib/biliParts'
import { HeroBanner } from './HeroBanner'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { Cover } from '../../shared/ui/Cover'
import { formatCount, formatDuration } from '../../shared/lib/format'

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
  /** 首屏那九条（轮播 5 + 右侧 4）。它可以被「换一换」单独换掉，下面推荐流不动。 */
  hero: Track[]
  fresh: number
  nextFresh: number
  scrollTop: number
  index: number
} = {
  items: [],
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
  const [items, setItems] = useState<Track[]>(feedMemory.items)
  const [hero, setHero] = useState<Track[]>(feedMemory.hero)
  const [heroLoading, setHeroLoading] = useState(false)
  /** 当前这批曲目的镜像。去重要在 setState 之外算，不然「新增了几条」永远是旧值。 */
  const itemsRef = useRef<Track[]>(feedMemory.items)
  const heroRef = useRef<Track[]>(feedMemory.hero)
  const [fresh, setFresh] = useState(feedMemory.fresh)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 下一批的 fresh_idx。接口按它返回「另一批」，同值重复取会拿到一样的。 */
  const nextFresh = useRef(feedMemory.nextFresh)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** 滚动事件比 React 状态回写快，用它挡住同一批的重复请求。 */
  const pending = useRef(false)
  /** 上一批一条新的都没带回来，就说明推荐流到头了，别再自动补。 */
  const exhausted = useRef(false)

  const load = useCallback(async (next: number, append = false): Promise<void> => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const list = await ipc.homeFeed(next)
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
      // 首屏那九条跟着第一页走；之后翻页只往推荐流里加，不动顶部。
      if (!append) {
        const top = merged.slice(0, 9)
        heroRef.current = top
        setHero(top)
      }
      if (list.length === 0) {
        if (append) exhausted.current = true
        setError(append ? '这一轮的推荐已经到底了，换一批看看。' : '这次没拿到推荐，换一批试试。')
      }
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    nextFresh.current = feedMemory.nextFresh
    if (feedMemory.items.length === 0) void load(1)
  }, [load])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    // 窗口化后滚动高度只代表已挂出来的这一段，按「第几条」恢复才落得回原处。
    const card =
      feedMemory.index > 0
        ? el.querySelector<HTMLElement>(`[data-track-card][data-index="${feedMemory.index}"]`)
        : null
    if (card) {
      el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
    } else if (feedMemory.items.length > 0) {
      el.scrollTop = feedMemory.scrollTop
    }
  }, [])

  useEffect(() => {
    feedMemory.items = items
  }, [items])

  useEffect(() => {
    feedMemory.hero = hero
  }, [hero])

  useEffect(() => {
    feedMemory.fresh = fresh
  }, [fresh])

  const more = (): void => {
    // 到底了就不再请求：滚动事件会一直触发，不挡住就是无限空请求。
    if (pending.current || loading || loadingMore || exhausted.current) return
    pending.current = true
    const next = nextFresh.current
    nextFresh.current = next + 1
    feedMemory.nextFresh = next + 1
    void load(next, true).finally(() => {
      pending.current = false
    })
  }

  /**
   * 轮播右侧那颗「换一换」只换首屏那九条：换一个 fresh_idx 取一页，
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
      const seen = new Set(itemsRef.current.map((t) => t.key))
      const swapped = list.filter((t) => !seen.has(t.key)).slice(0, 9)
      if (swapped.length > 0) {
        heroRef.current = swapped
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

  return (
    <div
      ref={scrollerRef}
      id="scroll-main"
      onScroll={(event) => {
        const el = event.currentTarget
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
       * 频道条照 B 站首页原版：左边两个圆形入口，右边两行等宽胶囊。
       * B 站这一带是白色 header 带、胶囊 #f6f7f8 铺在白上；我们页面底也是 #f6f7f8，
       * 所以这里自带一条白带，否则胶囊会和背景融成一片、整条读起来像空缺。
       * 右侧那列快捷链接不放：左侧栏已有同样入口，多一列会把这一带撑成三行。
       * 白带横向铺满，内边距和下面内容区同一套（px-4 / md:px-8），
       * 这样胶囊、轮播、卡片流的左右边界天然对齐，不用各自手写 padding。
       */}
      <nav className="mb-4 bg-[var(--panel)] py-3">
        {/* 右边多留 48px（换一换按钮 36 + gap 12）：首屏那一行右边有个竖排按钮，
            胶囊必须停在同一条线上，否则真机上胶囊比轮播宽出 50px，看着就是歪的。 */}
        <div className="flex items-start gap-5 px-4 md:px-8 lg:pl-8 lg:pr-20">
        <div className="flex shrink-0 items-start gap-3">
          {[
            { label: '热门', icon: 'flame' as const, tone: '#ff7a45', run: () => navigate({ kind: 'popular' }) },
            { label: '排行', icon: 'rank' as const, tone: 'var(--bili-pink)', run: () => navigate({ kind: 'ranking' }) },
          ].map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={entry.run}
              /* 不写固定宽度：按钮宽 = 圆形直径，圆的左缘就和下面胶囊、轮播、卡片同一条线。
                 之前 w-12 里居中的 32px 圆比左边线内缩 8px，整条带读起来就是歪的。 */
              className="t press flex flex-col items-center gap-1 rounded-[8px] py-0.5 text-[12px] text-[var(--text-2)] hover:text-[var(--text-1)]"
            >
              <span
                className="bili-channel-icon flex h-8 w-8 items-center justify-center rounded-full text-white"
                style={{ background: entry.tone }}
              >
                <Icon name={entry.icon} size={16} />
              </span>
              <span className="whitespace-nowrap">{entry.label}</span>
            </button>
          ))}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {PARTS.filter((part) => part.rid !== 0).map((part) => (
              <button
                key={part.rid}
                type="button"
                onClick={() => navigate({ kind: 'ranking', rid: part.rid })}
                /* B 站频道胶囊实测：底色 #f6f7f8、描边 #f1f2f3、圆角 6、高 28、字 13。
                   白底 + 深灰边比它抢眼得多，一屏 12 个就把轮播压住了。 */
                className="t flex h-7 items-center justify-center rounded-[6px] border border-[var(--ga1)] bg-[var(--ga0)] text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:bg-[var(--panel)] hover:text-[var(--accent)]"
              >
                {part.name}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* 首屏没内容才把错误摆在顶部；已经有一屏推荐时，这句话属于列表末尾。 */}
      {error && items.length === 0 ? (
        <p className="py-6 text-[13px] text-[var(--text-3)]">{error}</p>
      ) : null}

      {/*
       * B 站首页首屏是「大轮播 + 右侧卡片网格」：右侧给四张带封面的卡，
       * 而不是一列文字条目。轮播用前 5 条、右栏接 4 条，下面网格从第 9 条开始，
       * 同一批推荐不会在屏上出现两次。
       */}
      <div className="mb-5 flex items-start gap-3 px-4 pt-4 md:px-8">
        {/*
         * B 站 1280 视口实测：轮播 563×322（约占内容宽 45%），右侧四张卡每张约 340 宽。
         * 此前把轮播撑到 73%、右栏固定 336，卡片被压到 162 宽，首屏比例整个是反的。
         */}
        <div className="grid min-w-0 flex-1 items-start gap-4 lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
          <HeroBanner tracks={hero.slice(0, 5)} onOpen={(track) => navigate({ kind: 'watch', track })} />
          {hero.length > 5 ? (
            /* key 绑首条：换一换之后 key 变，整块重挂载，淡入从第一帧开始。 */
            <div key={hero[0]?.key} className="bili-hero-swap hidden grid-cols-2 gap-3 lg:grid">
              {hero.slice(5, 9).map((track) => (
                <button
                  key={track.key}
                  type="button"
                  onClick={() => navigate({ kind: 'watch', track })}
                  className="bili-card group min-w-0 text-left"
                >
                  <span className="relative block aspect-video overflow-hidden rounded-[6px]">
                    <Cover cover={track.cover} title={track.title} width={220} className="h-full w-full" />
                    <span className="num absolute bottom-1 right-1 rounded-[3px] bg-black/65 px-1 text-[10px] leading-[14px] text-white">
                      {formatDuration(track.duration_ms)}
                    </span>
                  </span>
                  {/* 字号跟下面网格一致（15px/22px）：这两块是同一种卡片，
                      只有尺寸不同；小两档会让首屏像另一个列表。 */}
                  <span className="mt-2 line-clamp-2 text-[15px] leading-[22px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                    {track.title}
                  </span>
                  <span className="num mt-1 block truncate text-[13px] text-[var(--text-3)]">
                    {track.artist}
                    {track.views ? ` · ${formatCount(track.views)} 播放` : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {/* B 站首页轮播右侧那颗竖排「换一换」：整列高度，刷新图标在上、字竖排。 */}
        <button
          type="button"
          onClick={() => void refreshHero()}
          title="换一换"
          className="bili-icon-btn t press flex w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] text-[12px] text-[var(--text-3)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Icon name="refresh" size={14} className={heroLoading ? 'animate-spin' : ''} />
          <span style={{ writingMode: 'vertical-rl' }} className="leading-none tracking-[0.18em]">
            换一换
          </span>
        </button>
      </div>

      {items.length > 0 ? (
        <>
          {/* 分区标题：长页面在这里有第一个断点，而不是从轮播一路铺到屏幕外。 */}
          <div className="px-4 md:px-8">
            <h2 className="mb-3 text-[17px] font-medium text-[var(--text-1)]">推荐</h2>
            <ContentGrid
              tracks={items.slice(9)}
              activeKey={activeKey}
              playing={playing}
              onNeedMore={more}
              lookahead={600}
              initialIndex={feedMemory.index}
            />
          </div>
        </>
      ) : null}
      {loading && items.length === 0 ? <CardGridSkeleton cards={10} /> : null}
      {loadingMore ? <BiliLoader compact label="正在加载更多…" /> : null}
      {error && items.length > 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-center text-[12.5px] text-[var(--text-3)]">{error}</p>
          <button
            type="button"
            onClick={refreshAll}
            className="t press rounded-[6px] border border-[var(--line)] px-3 py-1 text-[12.5px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            换一批
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
