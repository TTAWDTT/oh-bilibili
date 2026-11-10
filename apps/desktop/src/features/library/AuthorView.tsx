import { toastDone, toastFailure } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import { toWireError } from '../../shared/lib/errors'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { Avatar } from '../../shared/ui/Avatar'
import { EmptyState } from '../../shared/ui/EmptyState'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'

/**
 * UP 主页面。
 *
 * 有 mid 时走真正的空间接口 `space/wbi/arc/search`（WBI 签名），拿的是这个 UP
 * 主的全部投稿和总数。没有 mid 时退回「按作者名搜索」的结果聚合，那种情况下
 * 界面会标注数据来源，不假装是完整投稿列表。
 */
/** 等级徽章配色。B 站 LV1 灰、LV2 绿、LV3 蓝、LV4 青、LV5 紫、LV6 红。 */
function levelColor(level: number): string {
  return ['#9499a0', '#9499a0', '#7fa93b', '#3fa8d6', '#2fb3a8', '#a674d9', '#e23a5e'][level] ?? '#9499a0'
}

export function AuthorView({ name, mid }: { name: string; mid?: number | null }) {
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const navigate = useAppStore((state) => state.navigate)
  const setAuthorQuery = useAppStore((state) => state.setAuthorQuery)
  const [followed, setFollowed] = useState(false)
  const [card, setCard] = useState<import('../../shared/lib/ipc').AuthorCard | null>(null)
  const [total, setTotal] = useState(0)
  /** 是否退回了搜索聚合。界面要如实标注这一点。 */
  const [isFallback, setIsFallback] = useState(false)

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
    const mid = tracks?.find((t) => t.up_mid)?.up_mid
    if (!mid) {
      toastFailure('关注', { class: 'input', message: '这条结果没带 UP 主的 uid' })
      return
    }
    const next = !followed
    setFollowed(next)
    try {
      await ipc.followSet(mid, next)
      toastDone(next ? '已关注' : '已取消关注')
    } catch (e) {
      setFollowed(!next)
      toastFailure('关注', toWireError(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    setTracks(null)
    if (mid) {
      void ipc
        .spaceVideos(mid, 1)
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
  }, [name, mid])

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

  return (
    <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <header className="mb-6 flex items-center gap-4">
        <Avatar src={avatar} alt={name} size={64} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[26px] font-semibold text-[var(--text-1)]" title={name}>
              {name}
            </h2>
            {card && card.level > 0 ? (
              <span
                className="shrink-0 rounded-[3px] px-1.5 text-[11.5px] font-semibold leading-[18px] text-white"
                style={{ background: levelColor(card.level) }}
                title={`LV${card.level}`}
              >
                LV{card.level}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void follow()}
            className={[
              'mt-2 flex items-center gap-1 rounded-[4px] px-3 py-1 text-[14px]',
              followed
                ? 'border border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)]'
                : 'bg-[var(--accent)] text-white',
            ].join(' ')}
          >
            {followed ? '已关注' : '+ 关注'}
          </button>

          {card?.official ? (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-[3px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1.5 text-[11.5px] leading-[17px] text-[var(--accent)]">
              {card.official}
            </span>
          ) : null}
          {card?.sign ? (
            <p className="mt-1.5 line-clamp-1 text-[13px] text-[var(--text-2)]" title={card.sign}>
              {card.sign}
            </p>
          ) : null}

          <div className="num mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--text-3)]">
            {card ? (
              <>
                <span>{formatCount(card.fans)} 粉丝</span>
                <span>{formatCount(card.videos)} 投稿</span>
                <span>{formatCount(card.likes)} 获赞</span>
                <span className="rounded-[2px] bg-[var(--panel-raised)] px-1.5 leading-[16px]">
                  {isFallback
                    ? `空间接口不可用，下方是搜索结果里的 ${tracks.length} 个`
                    : `共 ${formatCount(total)} 个投稿`}
                </span>
              </>
            ) : (
              <>
                <span>{tracks.length} 个投稿</span>
                <span>{formatCount(views)} 累计播放</span>
                <span className="rounded-[2px] bg-[var(--panel-raised)] px-1.5 leading-[16px]">
                  来自搜索结果，不是完整投稿列表
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <ContentGrid
        tracks={tracks}
        activeKey={snapshot?.track?.key ?? null}
        playing={snapshot?.phase === 'playing'}
      />

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={() => setAuthorQuery(name)}
          className="bili-press rounded-[6px] border border-[var(--line)] px-4 py-2 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          在搜索里找他更多的投稿 →
        </button>
      </div>
    </div>
  )
}
