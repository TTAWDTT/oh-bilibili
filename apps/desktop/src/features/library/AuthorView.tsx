import { formatCount } from '../../shared/lib/format'
import { useEffect, useRef, useState } from 'react'
import { useAppStore, type AuthorRoute, type SpaceSection } from '../../app/appStore'
import { AuthorDynamics } from './AuthorDynamics'
import { AuthorCatalog } from './AuthorCatalog'
import { AuthorSubmissions } from './AuthorSubmissions'
import './author-space.css'
import { SpaceProfile, useSpaceProfile } from './SpaceProfile'
import { AuthorCollections } from './AuthorCollections'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
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
export function AuthorView({ view }: { view: AuthorRoute }) {
  const { name, mid, section = 'videos' } = view
  const replace = useAppStore((state) => state.replace)
  const [pinned, setPinned] = useState<Track | null>(null)
  const [masterpieces, setMasterpieces] = useState<Track[] | null>(null)
  const [masterpieceFailed, setMasterpieceFailed] = useState(false)
  const [masterpieceAttempt, setMasterpieceAttempt] = useState(0)
  const [brokenBanners, setBrokenBanners] = useState<string[]>([])
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const navigate = useAppStore((state) => state.navigate)
  const goBack = useAppStore((state) => state.goBack)
  const canGoBack = useAppStore((state) => state.history.length > 0)
  const me = useAuthStore((state) => state.auth?.user ?? null)
  /** null 表示还没问到：按钮先禁用，避免把旧作者的状态带过来。 */
  const [followed, setFollowed] = useState<boolean | null>(null)
  /** 关注请求在飞时不重复发；失败留在按钮上重试，不弹全局提示。 */
  const [followBusy, setFollowBusy] = useState(false)
  const [followFailed, setFollowFailed] = useState(false)
  const [card, setCard] = useState<import('../../shared/lib/ipc').AuthorCard | null>(null)
  const profile = useSpaceProfile(mid)
  const [total, setTotal] = useState(0)
  /** 是否退回了搜索聚合。界面要如实标注这一点。 */
  const [isFallback, setIsFallback] = useState(false)
  /** 排序：B 站空间页那三档。 */
  const [order, setOrder] = useState<'pubdate' | 'click' | 'stow'>('pubdate')
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 第几次取数：换排序/换作者后，旧的翻页响应直接丢掉。 */
  const loadEpoch = useRef(0)
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
      .catch(() => { if (!cancelled) setCard(null) })
    return () => {
      cancelled = true
    }
  }, [mid])

  useEffect(() => {
    if (!mid) return
    let active = true
    void ipc.spacePicks(mid, 'pinned').then(([track]) => {
      if (active) setPinned(track ?? null)
    }).catch(() => {})
    return () => { active = false }
  }, [mid])

  useEffect(() => {
    if (!mid) return
    let active = true
    void ipc.spacePicks(mid, 'masterpieces').then((list) => {
      if (active) setMasterpieces(list)
    }).catch(() => { if (active) setMasterpieceFailed(true) })
    return () => { active = false }
  }, [mid, masterpieceAttempt])

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

  /** 关注是真接口：写进你的 B 站关注列表，取关同理。没有 mid 就没有关注按钮。 */
  const follow = async (): Promise<void> => {
    if (!mid || followed === null || followBusy) return
    const next = !followed
    setFollowBusy(true)
    setFollowFailed(false)
    try {
      await ipc.followSet(mid, next)
      setFollowed(next)
    } catch {
      setFollowFailed(true)
    } finally {
      setFollowBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    // 换排序也要从第 1 页重新开始，否则下一页会从旧的页码继续。
    setPage(1)
    const epoch = ++loadEpoch.current
    if (mid) {
      void ipc
        .spaceVideos(mid, 1, order)
        .then(([list, total]) => {
          if (cancelled || loadEpoch.current !== epoch) return
          setIsFallback(false)
          setTracks(list)
          setTotal(total)
        })
        .catch(() => {
          // 空间接口不通时退回搜索聚合，并在界面上标注
          if (cancelled || loadEpoch.current !== epoch) return
          setIsFallback(true)
          void ipc
            .searchQ(name, 1)
            .then((list) => {
              if (cancelled || loadEpoch.current !== epoch) return
              const matched = list.filter((t) => t.up_mid === mid)
              setTracks(matched)
            })
            .catch(() => {
              if (!cancelled && loadEpoch.current === epoch) setTracks([])
            })
        })
      return () => {
        cancelled = true
      }
    }
    void ipc
      .searchQ(name, 1)
      .then((list) => {
        if (cancelled || loadEpoch.current !== epoch) return
        setIsFallback(true)
        const matched = list.filter((t) => t.artist === name)
        setTracks(matched)
      })
      .catch(() => {
        if (!cancelled && loadEpoch.current === epoch) setTracks([])
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
    const epoch = loadEpoch.current
    try {
      const [list] = await ipc.spaceVideos(mid, page + 1, order)
      if (loadEpoch.current !== epoch) return
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

  const avatar = card?.face || tracks?.find((t) => t.up_avatar)?.up_avatar || null
  const dress = card?.dress
  const member = dress?.membership
  const plate = dress?.nameplate
  const smallBanner = card?.banner_small && !brokenBanners.includes(card.banner_small) ? card.banner_small : null
  const banner = card?.banner && !brokenBanners.includes(card.banner) ? card.banner : smallBanner
  const isSelf = mid != null && me?.mid === mid
  const submissionCount = tracks && !isFallback ? total : card?.videos
  const show = (next: SpaceSection) => {
    if (view.shelf || view.catalogChild) {
      goBack()
      if (next === section) return
    }
    replace({ kind: 'author', name, mid: mid ?? null, section: next })
  }

  const showProfile = !!mid && section === 'videos' && !view.videoQuery

  return (
    <div id="scroll-main" className="author-space min-h-0 flex-1 overflow-y-auto">
      <header data-up-mid={mid == null ? undefined : String(mid)} className="space-masthead">
        {(banner || canGoBack) && (
          <div className="space-cover-strip">
            {banner && (
              <picture>
                {smallBanner && smallBanner !== banner && <source media="(max-width: 640px)" srcSet={smallBanner} />}
                <img data-space-banner src={banner} alt="" referrerPolicy="no-referrer"
                  onError={(event) => {
                    const failed = event.currentTarget.currentSrc === event.currentTarget.src ? banner : smallBanner
                    if (failed) setBrokenBanners((previous) => [...previous, failed])
                  }}
                  className="space-banner-image" />
              </picture>
            )}
            {canGoBack && (
              <button type="button" onClick={goBack} data-on-banner={banner ? '' : undefined}
                className="space-back"><Icon name="chevronLeft" size={16} />返回</button>
            )}
          </div>
        )}
        <div className="space-inner space-identity">
          <div className="space-portrait" data-on-banner={banner ? '' : undefined}>
            <Avatar src={avatar} alt={name} size={72} bordered={false} />
            {dress?.pendant && <img src={dress.pendant} alt={dress.pendant_name ?? '头像挂件'} referrerPolicy="no-referrer"
              className="pointer-events-none absolute left-1/2 top-1/2 h-[125%] w-[125%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
              onError={(event) => { event.currentTarget.hidden = true }} />}
            {profile.value?.official_icon ? <img src={profile.value.official_icon} alt={card?.official || 'B 站认证'}
              referrerPolicy="no-referrer" className="absolute bottom-0 right-0 h-5 w-5" /> : card?.official_type != null && <span title={card.official_type === 1 ? '机构认证' : '个人认证'}
              className="absolute bottom-0 right-0 grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--panel)] text-white"
              style={{ backgroundColor: card.official_type === 1 ? 'var(--accent)' : '#e99718' }}>
              <Icon name="check" size={12} />
            </span>}
          </div>
          <div className="space-bio min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="max-w-full break-words text-[22px] leading-tight font-semibold text-[var(--text-1)]" style={{ color: member?.nickname_color ?? undefined }} title={card?.name || name}>
                {card?.name || name}
              </h2>
              {card ? <LevelBadge level={card.level} /> : null}
              {member && (member.image || member.animated ? <picture>
                {member.animated && member.image && <source media="(prefers-reduced-motion: no-preference)" srcSet={member.animated} />}
                <img src={member.image ?? member.animated ?? undefined} alt={member.label ?? '大会员'} referrerPolicy="no-referrer"
                  className="h-4 w-auto max-w-[76px] object-contain" />
              </picture> : member.label && <span className="text-[12px]">{member.label}</span>)}
              {plate && <img src={plate.small ?? plate.image} alt={plate.name} title={plate.name} referrerPolicy="no-referrer"
                className="h-5 w-auto max-w-12 object-contain" />}
            </div>
            {card?.official && <p className="mt-1 text-[12px] leading-snug text-[var(--text-2)]">{card.official}</p>}
            {card?.sign ? (
              <p className="mt-1 line-clamp-2 break-words text-[13px] text-[var(--text-2)]" title={card.sign}>
                {card.sign}
              </p>
            ) : null}
            <div className="num mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--text-3)]">
              {card?.following_count != null && <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.following_count)}</span> 关注</span>}
              {card?.fans != null && <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.fans)}</span> 粉丝</span>}
              {submissionCount != null && <span>共 <span className="font-medium text-[var(--text-1)]">{formatCount(submissionCount)}</span> 个投稿</span>}
              {card?.likes != null && <span><span className="font-medium text-[var(--text-1)]">{formatCount(card.likes)}</span> 获赞</span>}
            </div>
          </div>
          {!isSelf && mid ? (
            <div className="space-actions flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={followed === null || followBusy}
                onClick={() => void follow()}
                aria-live="polite"
                className={[
                  't press flex h-8 shrink-0 items-center justify-center gap-1 rounded-[6px] px-4 text-[14px]',
                  followFailed
                    ? 'border border-[var(--danger)] text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,white)]'
                    : followed === true
                      ? 'border border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)]'
                      : 'bg-[var(--accent-strong)] text-white hover:opacity-90',
                  followBusy ? 'opacity-70' : '',
                ].join(' ')}
              >
                <Icon name={followFailed ? 'refresh' : followed ? 'check' : 'plus'} size={14} />
                {followBusy ? '处理中…' : followFailed ? '重试关注' : followed ? '已关注' : '关注'}
              </button>
              <button
                type="button"
                data-focus-id={`author-dm:${mid}`}
                onClick={() => navigate({
                  kind: 'messages', tab: 'direct', peer: { mid, name: card?.name || name, avatar: card?.face ?? '' },
                  ...(me ? { accountMid: me.mid } : {}),
                }, undefined, `author-dm:${mid}`)}
                className="t press flex h-8 items-center gap-1 rounded-[6px] border border-[var(--line)] px-3 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Icon name="message" size={14} />
                发消息
              </button>
            </div>
          ) : null}
        </div>
        {mid && (
          <nav aria-label="空间内容" className="space-tabs">
            {([['videos', '投稿'], ['dynamics', '动态'], ['masterpieces', '代表作'], ['collections', '合集和系列'], ['catalog', '更多内容']] as const)
              .filter(([id]) => id !== 'masterpieces' || !!masterpieces?.length || section === id)
              .map(([id, label]) => (
                <button type="button" key={id} aria-pressed={section === id} onClick={() => show(id)}
                  className="space-tab">
                  {label}
                </button>
              ))}
          </nav>
        )}
      </header>

      <div className={`space-inner space-body${showProfile ? ' with-profile' : ''}`}>
        {showProfile && <SpaceProfile mid={mid} card={card} isSelf={isSelf} profile={profile} />}
        <div className="space-content min-w-0">
          {mid && section === 'catalog' ? (
            <AuthorCatalog view={view} mid={mid} />
          ) : mid && section === 'dynamics' ? (
            <AuthorDynamics key={mid} mid={mid} view={view} />
          ) : mid && section === 'collections' ? (
            <AuthorCollections key={`${view.shelf?.kind}-${view.shelf?.id}-${view.shelfPage ?? 1}`} view={view} mid={mid} />
          ) : section === 'masterpieces' ? (
            masterpieceFailed ? (
              <EmptyState icon="biliTv" compact title="代表作暂时没取到" action={{
                label: '重试', onClick: () => { setMasterpieceFailed(false); setMasterpieceAttempt(n => n + 1) },
              }} />
            ) : masterpieces === null ? <BiliLoader label="正在取代表作…" /> : masterpieces.length ? (
              <ContentGrid tracks={masterpieces} activeKey={snapshot?.track?.key ?? null} playing={snapshot?.phase === 'playing'} />
            ) : <p className="text-[14px] text-[var(--text-3)]">还没有设置代表作</p>
          ) : (
            <AuthorSubmissions view={view} tracks={tracks} pinned={pinned} order={order} onOrder={setOrder}
              isFallback={isFallback} loadingMore={loadingMore} onNeedMore={loadMore} />
          )}
        </div>
      </div>
    </div>
  )
}
