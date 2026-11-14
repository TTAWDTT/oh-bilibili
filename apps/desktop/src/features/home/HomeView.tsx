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
import { LiveRow } from './LiveRow'
import { BangumiRow } from './BangumiRow'
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
  /** 首屏那十一条（轮播 5 + 右侧 6）。它可以被「换一换」单独换掉，下面推荐流不动。 */
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
      const seen = new Set(itemsRef.current.map((t) => t.key))
      const swapped = list.filter((t) => !seen.has(t.key)).slice(0, 11)
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
       * 频道条照 B 站首页：左边两颗圆形入口，右边一排窄胶囊。
       * B 站胶囊实测 #f6f7f8、无描边、深色字、28 高、宽约 60——一格只放得下两个分区名。
       * 之前把 12 个胶囊拉成 6 列网格、每格 100 宽，整条带子像一组表单输入框；
       * 右侧那块快捷入口又和左栏完全重复，删掉后 12 个胶囊正好一行排完。
       */}
      <nav className="mb-4 bg-[var(--panel)] py-3">
        <div className="flex items-center gap-5 px-4 md:px-8">
          <div className="flex shrink-0 items-start gap-3">
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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-[var(--line)] pl-5">
            {PARTS.filter((part) => part.rid !== 0).map((part) => (
              <button
                key={part.rid}
                type="button"
                onClick={() => navigate({ kind: 'ranking', rid: part.rid })}
                className="t h-7 w-[62px] shrink-0 rounded-[4px] bg-[var(--ga0)] text-[12.5px] text-[var(--text-1)] hover:bg-[var(--line)] hover:text-[var(--accent)]"
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
       * 而不是一列文字条目。轮播用前 5 条、右栏接 6 条，下面网格从第 11 条开始，
       * 同一批推荐不会在屏上出现两次。
       */}
      {hero.length > 0 ? (
        <div className="mb-4 px-4 pt-4 md:px-8">
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
          <HeroBanner tracks={hero.slice(0, 5)} onOpen={(track) => navigate({ kind: 'watch', track })} />
          {hero.length > 5 ? (
            /* key 绑首条：换一换之后 key 变，整块重挂载，淡入从第一帧开始。 */
            <div key={hero[0]?.key} className="bili-hero-swap hidden grid-cols-3 gap-3 lg:grid">
              {hero.slice(5, 11).map((track) => (
                <button
                  key={track.key}
                  type="button"
                  onClick={() => navigate({ kind: 'watch', track })}
                  className="bili-card group min-w-0 text-left"
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
                  <span className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
                    <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[13px]">
                      UP
                    </span>
                    <span className="truncate">{track.artist}</span>
                    {track.views ? <span className="num shrink-0">· {formatCount(track.views)} 播放</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          </div>
        </div>
      ) : null}

      {/* 直播与番剧紧贴首屏：放在无限推荐流后面等于永远看不到，推荐流本身没有底 */}
      <LiveRow />
      <BangumiRow />

      {items.length > 0 ? (
        <div className="px-4 md:px-8">
          <ContentGrid
            tracks={items.slice(11)}
            activeKey={activeKey}
            playing={playing}
            onNeedMore={more}
            lookahead={600}
            initialIndex={feedMemory.index}
          />
        </div>
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
