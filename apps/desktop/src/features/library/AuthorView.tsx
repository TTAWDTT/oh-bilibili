import { toastDone, toastFailure } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import { toWireError } from '../../shared/lib/errors'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { Mascot2233 } from '../../shared/ui/Mascot2233'
import { EmptyState } from '../../shared/ui/EmptyState'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
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
  const navigate = useAppStore((state) => state.navigate)
  const setAuthorQuery = useAppStore((state) => state.setAuthorQuery)
  const me = useAuthStore((state) => state.auth?.user ?? null)
  const [followed, setFollowed] = useState(false)
  const [card, setCard] = useState<import('../../shared/lib/ipc').AuthorCard | null>(null)
  const [total, setTotal] = useState(0)
  /** 是否退回了搜索聚合。界面要如实标注这一点。 */
  const [isFallback, setIsFallback] = useState(false)
  /** 排序：B 站空间页那三档。 */
  const [order, setOrder] = useState<'pubdate' | 'click' | 'stow'>('pubdate')
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
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

  /** 关注是真接口：写进你的 B 站关注列表，取关同理。 */
  const follow = async (): Promise<void> => {
    // 页面本身就带着 mid（从搜索结果、关注列表点进来时都有），
    // 不该再从投稿列表里反推：列表是「按作者名搜索」的兜底时，条目可能不带 mid。
    const ownerMid = mid ?? tracks?.find((t) => t.up_mid)?.up_mid
    if (!ownerMid) {
      toastFailure('关注', { class: 'input', message: '这条结果没带 UP 主的 uid' })
      return
    }
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
    setTracks(null)
    setPage(1)
    setIsFallback(false)
    scroller.current?.scrollTo({ top: 0 })
    if (mid) {
      void ipc
        .spaceVideos(mid, 1, order)
        .then(([list, total]) => {
          if (cancelled) return
          setTracks(list)
          setTotal(total)
        })
        .catch(() => {
          // 空间接口不通时退回搜索聚合，并在界面上标注
          if (cancelled) return
          setIsFallback(true)
          void ipc
            .searchQ(name, 1)
            .then((list) => {
              if (!cancelled) setTracks(list.filter((t) => t.up_mid === mid))
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
        setTracks(list.filter((t) => t.artist === name))
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

  if (tracks === null) return <TrackListSkeleton rows={6} />
  if (tracks.length === 0) {
    return (
      <EmptyState
        icon="biliTv"
        title="没找到这个 UP 主"
        detail="这个 UP 主没有可显示的视频，或空间接口取不到。"
        action={{ label: '回到搜索', onClick: () => navigate({ kind: 'search' }) }}
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
      <header className="mb-6 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div
          className="relative h-[88px] overflow-hidden rounded-t-[7px]"
          style={{
            background: 'linear-gradient(115deg, color-mix(in srgb, var(--bili-pink) 23%, white), color-mix(in srgb, var(--bili-pink) 8%, white) 48%, color-mix(in srgb, var(--accent) 20%, white))',
          }}
        >
          <Mascot2233 height={176} className="pointer-events-none absolute -bottom-[62px] -right-3 opacity-15 sm:right-5" />
        </div>
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 px-4 pb-5 sm:px-5">
          <div className="relative -mt-9 shrink-0 rounded-full bg-white p-[4px] shadow-[0_0_0_2px_color-mix(in_srgb,var(--bili-pink)_25%,white),0_3px_12px_rgba(255,102,153,0.12)]">
            <Avatar src={avatar} alt={name} size={88} bordered={false} />
          </div>
          <div className="min-w-0 max-w-full flex-[1_1_240px] pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex min-w-0 max-w-full items-center gap-2">
                <h2 className="truncate text-[26px] font-semibold text-[var(--text-1)]" title={name}>
                  {name}
                </h2>
                {card ? <LevelBadge level={card.level} /> : null}
              </div>
              {isSelf ? null : (
                <button
                  type="button"
                  onClick={() => void follow()}
                  className={[
                    't press ml-auto flex h-8 shrink-0 items-center justify-center gap-1 rounded-[6px] px-4 text-[14px]',
                    followed
                      ? 'border border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)]'
                      : 'bg-[var(--accent)] text-white hover:opacity-90',
                  ].join(' ')}
                >
                  <Icon name={followed ? 'check' : 'plus'} size={14} />
                  {followed ? '已关注' : '关注'}
                </button>
              )}
            </div>
            {card?.official ? (
              <span className="mt-2 inline-flex max-w-full items-center gap-1 break-words rounded-[3px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1.5 text-[11.5px] leading-[17px] text-[var(--accent)]">
                {card.official}
              </span>
            ) : null}
            {card?.sign ? (
              <p className="mt-2 line-clamp-2 break-words text-[13px] text-[var(--text-2)]" title={card.sign}>
                {card.sign}
              </p>
            ) : null}
            <div className="num mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--text-3)]">
              {card ? (
                <>
                  <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.fans)}</span> 粉丝</span>
                  <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.videos)}</span> 投稿</span>
                  <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.likes)}</span> 获赞</span>
                  <span className="rounded-[3px] bg-[var(--panel-raised)] px-1.5 leading-[18px]">
                    {isFallback
                      ? `空间接口不可用，下方是搜索结果里的 ${tracks.length} 个`
                      : `共 ${formatCount(total)} 个投稿`}
                  </span>
                </>
              ) : (
                <>
                  <span>{tracks.length} 个投稿</span>
                  <span>{formatCount(views)} 累计播放</span>
                  <span className="rounded-[3px] bg-[var(--panel-raised)] px-1.5 leading-[18px]">
                    来自搜索结果，不是完整投稿列表
                  </span>
                </>
              )}
            </div>
          </div>
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
        <p className="py-3 text-center text-[12px] text-[var(--text-3)]">正在取更多投稿…</p>
      ) : null}

      {isFallback ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setAuthorQuery(name)}
            className="bili-press rounded-[6px] border border-[var(--line)] px-4 py-2 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            在搜索里找他更多的投稿 →
          </button>
        </div>
      ) : null}
    </div>
  )
}
