import { toastDone, toastFailure } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import { toWireError } from '../../shared/lib/errors'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'
import { useAuthStore } from '../auth/authStore'

/**
 * UP 主页面。
 *
 * 有 mid 时走真正的空间接口 `space/wbi/arc/search`（WBI 签名），拿的是这个 UP
 * 主的全部投稿和总数。没有 mid 时退回「按作者名搜索」的结果聚合，那种情况下
 * 界面会标注数据来源，不假装是完整投稿列表。
 */
export function AuthorView({ name, mid }: { name: string; mid?: number | null }) {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const focusSearch = useAppStore((state) => state.focusSearch)
  const navigate = useAppStore((state) => state.navigate)
  const searchFor = useAppStore((state) => state.setHeroQuery)
  const me = useAuthStore((state) => state.auth?.user ?? null)
  /** null 表示还没问到：按钮先禁用，避免把旧作者的状态带过来。 */
  const [followed, setFollowed] = useState<boolean | null>(null)
  const [card, setCard] = useState<import('../../shared/lib/ipc').AuthorCard | null>(null)
  const [total, setTotal] = useState(0)
  /** 是否退回了搜索聚合。界面要如实标注这一点。 */
  const [isFallback, setIsFallback] = useState(false)
  /** 排序：B 站空间页那三档。 */
  const [order, setOrder] = useState<'pubdate' | 'click' | 'stow'>('pubdate')
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  /**
   * 页首展示的那一件作品。只在第一次拿到投稿时定下来：
   * 切排序、翻页都不许换图，否则整页会跟着跳。
   */
  const [hero, setHero] = useState<Track | null>(null)
  /** 页首作品属于哪个作者：换作者才重置，换排序不动。 */
  const heroOwner = useRef<string | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)

  // 粉丝数与签名走 card 接口，公开可见。
  useEffect(() => {
    if (!mid) return
    let cancelled = false
    void ipc
      .authorCard(mid)
      .then((c) => {
        if (!cancelled) setCard(c)
      })
      .catch(() => setCard(null))
    return () => {
      cancelled = true
    }
  }, [mid])

  // 空间页也要知道自己有没有关注这个人。之前默认 false，已关注的 UP 也显示「+ 关注」。
  useEffect(() => {
    if (!mid) return
    let cancelled = false
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

  /** 关注是真接口：写进你的 B 站关注列表，取关同理。 */
  const follow = async (): Promise<void> => {
    // 页面本身就带着 mid（从搜索结果、关注列表点进来时都有），
    // 不该再从投稿列表里反推：列表是「按作者名搜索」的兜底时，条目可能不带 mid。
    const ownerMid = mid ?? tracks?.find((t) => t.up_mid)?.up_mid
    if (!ownerMid) {
      toastFailure('关注', { class: 'input', message: '这条结果没带 UP 主的 uid' })
      return
    }
    if (followed === null) return
    const next = !followed
    setFollowed(next)
    try {
      await ipc.followSet(ownerMid, next)
      toastDone(next ? '已关注' : '已取消关注')
    } catch (e) {
      setFollowed(!next)
      toastFailure('关注', toWireError(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    const owner = `${mid ?? 'name'}:${name}`
    if (heroOwner.current !== owner) {
      // 换人：旧作者的头像、粉丝数、关注态一概不能留；换排序则保留列表等新数据。
      heroOwner.current = owner
      setTracks(null)
      setPage(1)
      setIsFallback(false)
      setCard(null)
      setFollowed(null)
      setHero(null)
      scroller.current?.scrollTo({ top: 0 })
    }
    /** 第一次拿到这一页投稿时定下页首作品；之后换排序、翻页都不再动它。 */
    const pickHero = (list: Track[]): void => {
      // 只有名字时无法核对 up_mid，不拿它当页首，免得同名作者串图。
      if (!mid || heroOwner.current !== owner) return
      setHero((current) => current ?? list[0] ?? null)
    }
    if (mid) {
      void ipc
        .spaceVideos(mid, 1, order)
        .then(([list, total]) => {
          if (cancelled) return
          setTracks(list)
          setTotal(total)
          pickHero(list)
        })
        .catch(() => {
          // 空间接口不通时退回搜索聚合，并在界面上标注
          if (cancelled) return
          setIsFallback(true)
          void ipc
            .searchQ(name, 1)
            .then((list) => {
              if (cancelled) return
              const matched = list.filter((t) => t.up_mid === mid)
              setTracks(matched)
              pickHero(matched)
            })
            .catch(() => {
              if (!cancelled) setTracks([])
            })
        })
      return () => {
        cancelled = true
      }
    }
    void ipc
      .searchQ(name, 1)
      .then((list) => {
        if (cancelled) return
        setIsFallback(true)
        const matched = list.filter((t) => t.artist === name)
        setTracks(matched)
        pickHero(matched)
      })
      .catch(() => {
        if (!cancelled) setTracks([])
      })
    return () => {
      cancelled = true
    }
  }, [name, mid, order])

  /** 往下滚到底再取下一页；空间接口一页 50 条。 */
  const loadMore = async (): Promise<void> => {
    if (!mid || loadingRef.current || isFallback || !tracks || tracks.length >= total) return
    loadingRef.current = true
    setLoadingMore(true)
    try {
      const [list] = await ipc.spaceVideos(mid, page + 1, order)
      if (list.length === 0) {
        // 接口提前到底：把总数对齐，之后就别再对着同一页空转
        setTotal(tracks.length)
      } else {
        setTracks((prev) => [...(prev ?? []), ...list])
        setPage((n) => n + 1)
      }
    } catch {
      // 取不到就停在已加载的那一页，不假装到底
    } finally {
      loadingRef.current = false
      setLoadingMore(false)
    }
  }

  if (tracks === null) return <BiliLoader label="正在取投稿…" />
  if (tracks.length === 0) {
    return (
      <EmptyState
        icon="biliTv"
        title={
          !mid
            ? '没找到这个 UP 主'
            : isFallback
              ? '空间内容没取到'
              : '这个 UP 主还没有公开投稿'
        }
        detail={
          !mid
            ? '这个 UP 主没有可显示的视频，或空间接口取不到。'
            : isFallback
              ? '空间接口没有取到，可能被限流；可以稍后再试或直接去 B 站看。'
              : '空间接口没有返回可显示的视频。'
        }
        action={
          mid
            ? {
                label: '在 B 站打开空间',
                onClick: () => {
                  void ipc
                    .openExternal(`https://space.bilibili.com/${mid}`)
                    .catch((cause) => toastFailure('打开空间', cause))
                },
              }
            : { label: '回到搜索', onClick: () => focusSearch() }
        }
      />
    )
  }

  const avatar = card?.face || tracks.find((t) => t.up_avatar)?.up_avatar || null
  const views = tracks.reduce((sum, t) => sum + (t.views ?? 0), 0)
  const isSelf = mid != null && me?.mid === mid

  return (
    <div
      ref={scroller}
      id="scroll-main"
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <header className="mb-5 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          {/* 左半：作者本人。渐变只留头像后面一小块，不再用整条装饰吃掉首屏高度。 */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 items-start gap-4">
              <div
                className="shrink-0 rounded-full p-[3px]"
                style={{ background: 'color-mix(in srgb, var(--accent) 22%, white)' }}
              >
                <Avatar src={avatar} alt={name} size={72} bordered={false} />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="truncate text-[24px] font-semibold text-[var(--text-1)]" title={name}>
                    {name}
                  </h2>
                  {card ? <LevelBadge level={card.level} /> : null}
                  {card?.official ? (
                    <span className="inline-flex max-w-full items-center rounded-[3px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1.5 text-[11.5px] leading-[17px] text-[var(--accent)]">
                      {card.official}
                    </span>
                  ) : null}
                </div>
                {card?.sign ? (
                  <p className="mt-1.5 line-clamp-2 break-words text-[13px] text-[var(--text-2)]" title={card.sign}>
                    {card.sign}
                  </p>
                ) : null}
                <div className="num mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--text-3)]">
                  {card ? (
                    <>
                      <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.fans)}</span> 粉丝</span>
                      <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.videos)}</span> 投稿</span>
                      <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.likes)}</span> 获赞</span>
                    </>
                  ) : (
                    <>
                      <span>{tracks.length} 个投稿</span>
                      <span>{formatCount(views)} 累计播放</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {isSelf ? null : (
              <div className="flex flex-wrap items-center gap-2">
                {mid ? (
                  <>
                    <button
                      type="button"
                      title="去 B 站给 UP 主充电"
                      onClick={() =>
                        void ipc
                          .openExternal(`https://space.bilibili.com/${mid}`)
                          .catch((cause) => toastFailure('打开充电页', cause))
                      }
                      className="t press flex h-8 items-center gap-1 rounded-[6px] border border-[var(--line)] px-3 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      <Icon name="battery" size={14} />
                      充电
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void ipc
                          .openExternal(`https://message.bilibili.com/#/whisper/mid${mid}`)
                          .catch((cause) => toastFailure('打开私信', cause))
                      }
                      className="t press flex h-8 items-center gap-1 rounded-[6px] border border-[var(--line)] px-3 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      <Icon name="message" size={14} />
                      发消息
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  disabled={followed === null}
                  onClick={() => void follow()}
                  className={[
                    't press flex h-8 shrink-0 items-center justify-center gap-1 rounded-[6px] px-4 text-[14px]',
                    followed === true
                      ? 'border border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)]'
                      : 'bg-[var(--accent)] text-white hover:opacity-90',
                  ].join(' ')}
                >
                  <Icon name={followed ? 'check' : 'plus'} size={14} />
                  {followed ? '已关注' : '关注'}
                </button>
                <span className="rounded-[3px] bg-[var(--panel-raised)] px-1.5 text-[12px] leading-[20px] text-[var(--text-3)]">
                  {isFallback
                    ? `空间接口不可用，下方是搜索结果里的 ${tracks.length} 个`
                    : `共 ${formatCount(total)} 个投稿`}
                </span>
              </div>
            )}
          </div>

          {hero ? (
            <button
              type="button"
              data-author-hero
              data-focus-key={hero.key}
              aria-label={`观看 ${hero.title}`}
              onClick={() => navigate({ kind: 'watch', track: hero })}
              className="group flex min-w-0 items-stretch gap-3 text-left lg:flex-col lg:gap-0"
            >
              <span
                className="relative w-[132px] shrink-0 overflow-hidden rounded-[6px] border border-[var(--line)] sm:w-[176px] lg:w-full"
                style={{ aspectRatio: '16 / 9' }}
              >
                <Cover cover={hero.cover} title={hero.title} width={520} className="h-full w-full" />
                <span className="absolute left-2 top-2 rounded-[3px] bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                  {isFallback ? '搜索结果' : '近期投稿'}
                </span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 rounded-b-[6px] bg-[var(--panel-raised)] px-3 py-2 lg:rounded-b-[6px] lg:rounded-t-none">
                <span
                  className="line-clamp-2 text-[14px] font-medium leading-[20px] text-[var(--text-1)] group-hover:text-[var(--accent)]"
                  title={hero.title}
                >
                  {hero.title}
                </span>
                <span className="num text-[12px] text-[var(--text-3)]">
                  {formatCount(hero.views ?? 0)} 播放
                </span>
              </span>
            </button>
          ) : null}
        </div>
      </header>

      {/* 排序只在拿到了完整投稿列表时才有意义；搜索聚合下按比例排序是假的。 */}
      {mid && !isFallback ? (
        <div className="mb-3 flex items-center gap-1">
          {(
            [
              ['pubdate', '最新发布'],
              ['click', '最多播放'],
              ['stow', '最多收藏'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => setOrder(value)}
              className={`t press rounded-[4px] px-3 py-1 text-[13px] ${
                order === value
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-3)] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)]'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="num ml-auto text-[12px] text-[var(--text-3)]">
            已加载 {tracks.length} / {total}
          </span>
        </div>
      ) : null}

      <ContentGrid
        tracks={tracks}
        activeKey={snapshot?.track?.key ?? null}
        playing={snapshot?.phase === 'playing'}
        onNeedMore={() => void loadMore()}
      />

      {loadingMore ? (
        <BiliLoader compact label="正在取更多投稿…" />
      ) : null}

      {isFallback ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => searchFor(name)}
            className="bili-press rounded-[6px] border border-[var(--line)] px-4 py-2 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            在搜索里找他更多的投稿 →
          </button>
        </div>
      ) : null}
    </div>
  )
}
