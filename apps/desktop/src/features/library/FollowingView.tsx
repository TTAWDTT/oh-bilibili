import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Followed } from '../../shared/lib/contract'
import type { AuthorCard } from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { PageTitle } from '../../shared/ui/PageTitle'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'
import { PREFETCH_PX } from '../../shared/lib/prefetch'
import { BiliLoader } from '../../shared/ui/BiliLoader'

/** 名片按 mid 缓存，同一个 UP 反复悬停不再打接口。 */
const cards = new Map<number, Promise<AuthorCard>>()

function authorCardOf(mid: number): Promise<AuthorCard> {
  let card = cards.get(mid)
  if (!card) {
    card = ipc.authorCard(mid)
    cards.set(mid, card)
    card.catch(() => cards.delete(mid))
  }
  return card
}

type Hover = { user: Followed; anchor: { top: number; left: number; right: number } }

/** 名片贴在被悬停的卡片右侧；右边放不下就翻到左侧，再夹进窗口。 */
function popoverStyle(anchor: Hover['anchor']): { left: number; top: number; width: number } {
  const width = 320
  const gap = 10
  let left = anchor.right + gap
  if (left + width > window.innerWidth - 8) left = anchor.left - width - gap
  if (left < 8) left = 8
  const top = Math.min(Math.max(anchor.top, 8), Math.max(8, window.innerHeight - 196))
  return { left, top, width }
}

/**
 * 我关注的人。
 *
 * 只读：不做关注/取关，因为那会给真实 UP 主发通知。
 * 点一个进他的主页，和 B 站的空间页入口一致；悬停出名片，和 B 站关注列表一致。
 */
export function FollowingView() {
  const navigate = useAppStore((s) => s.navigate)
  const [items, setItems] = useState<Followed[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  /** 翻页没取到：停在已加载的人，链子别再自动往下撞。 */
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  const [loaded, setLoaded] = useState<Record<number, AuthorCard>>({})
  const boxRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const pageRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const load = async (next: number): Promise<void> => {
    if (loadingRef.current || next <= pageRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const [list, count] = await ipc.following(next)
      setItems((prev) => (next === 1 ? list : [...prev, ...list]))
      setTotal(count)
      pageRef.current = next
      setPage(next)
      setFailed(false)
      // 每页 50 条（接口上限），到这里才知道是不是真到底
      if (list.length === 0 || next * 50 >= count) setDone(true)
    } catch (e) {
      // 第一页失败才是「关注列表没取到」；翻页失败只是这一段没取到，
      // 把已经拿到的人留在屏幕上，给个重试，别整页换成错误态。
      if (next === 1) setError(toWireError(e).message)
      else setFailed(true)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 取回一页后缓冲还不够深就继续取。关注列表常一页装不满窗口
  // （328 个关注、一屏能放 20 个），光靠滚动事件永远触发不了。
  useEffect(() => {
    const box = boxRef.current
    if (!box || page === 0 || done || failed) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < PREFETCH_PX) void load(page + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, done, loading, failed])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const mid = hover?.user.mid

  useEffect(() => {
    if (!mid || loaded[mid]) return
    let alive = true
    void authorCardOf(mid)
      .then((card) => {
        if (alive) setLoaded((prev) => ({ ...prev, [mid]: card }))
      })
      .catch(() => {
        // 名片取不到就只显示列表里已有的头像、昵称与签名
      })
    return () => {
      alive = false
    }
  }, [mid, loaded])

  const show = (user: Followed, el: HTMLElement): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    // 鼠标扫过整列时会一路触发，留一帧的延迟避免名片疯狂闪
    timerRef.current = window.setTimeout(() => {
      const rect = el.getBoundingClientRect()
      setHover({ user, anchor: { top: rect.top, left: rect.left, right: rect.right } })
    }, 40)
  }

  const hide = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    setHover(null)
  }

  if (error) {
    return (
      <EmptyState
        icon="user"
        title="关注列表没取到"
        detail={error}
        action={{ label: '去设置登录', onClick: () => navigate({ kind: 'settings' }) }}
      />
    )
  }

  if (page === 0 && loading) return <TrackListSkeleton rows={5} />

  if (done && items.length === 0) {
    return (
      <EmptyState
        icon="user"
        title="还没有关注任何人"
        detail="在观看页点 UP 主名字进主页，那里可以关注。"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  const card = hover ? loaded[hover.user.mid] : undefined

  return (
    <div
      ref={boxRef}
      id="scroll-main"
      onScroll={() => {
        hide()
        const box = boxRef.current
        if (box && !done && !failed && box.scrollHeight - box.scrollTop - box.clientHeight < PREFETCH_PX) {
          void load(page + 1)
        }
      }}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <PageTitle extra={formatCount(total)}>我关注的人</PageTitle>
      <div>
        <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {items.map((u) => (
            <li key={u.mid}>
              <button
                type="button"
                onClick={() => navigate({ kind: 'author', name: u.name, mid: u.mid })}
                onPointerEnter={(event) => show(u, event.currentTarget)}
                onPointerLeave={hide}
                onFocus={(event) => show(u, event.currentTarget)}
                onBlur={hide}
                className="t press flex w-full items-center gap-2.5 rounded-[8px] border border-[var(--line)] px-2.5 py-2 text-left hover:bg-[var(--panel-alt)]"
              >
                <span className="relative shrink-0">
                  <Avatar src={u.face} alt={u.name} size={36} />
                  {u.special ? (
                    <span
                      title="特别关注"
                      className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#ffb027] text-white shadow-[0_0_0_1.5px_var(--panel)]"
                    >
                      <Icon name="star" size={9} />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-[13px] text-[var(--text-1)]">{u.name}</span>
                    {u.official != null ? (
                      <span
                        title={u.official === 1 ? '机构认证' : '个人认证'}
                        className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-white"
                        style={{ background: u.official === 1 ? 'var(--accent)' : '#ffb027' }}
                      >
                        <Icon name="check" size={9} />
                      </span>
                    ) : null}
                    {u.mutual ? (
                      <span className="shrink-0 rounded-[2px] bg-[var(--panel-raised)] px-1 text-[10px] leading-[15px] text-[var(--text-3)]">
                        互关
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-3)]">
                    {u.sign || '这个人很神秘，什么都没写'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {loading ? <BiliLoader compact label="正在取…" /> : null}
        {failed && !loading ? (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={() => void load(page + 1)}
              className="t press text-[12px] text-[var(--accent)] hover:underline"
            >
              没取到，重试
            </button>
          </div>
        ) : null}
        {done && items.length > 0 ? (
          <p className="py-3 text-center text-[11px] text-[var(--text-3)]">到底了</p>
        ) : null}
      </div>
      {hover
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[60] rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
              style={popoverStyle(hover.anchor)}
            >
              <div className="flex items-start gap-2.5">
                <Avatar src={hover.user.face} alt={hover.user.name} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-medium text-[var(--text-1)]">
                      {hover.user.name}
                    </span>
                    {card ? <LevelBadge level={card.level} /> : null}
                    {hover.user.official != null ? (
                      <span
                        title={hover.user.official === 1 ? '机构认证' : '个人认证'}
                        className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-white"
                        style={{ background: hover.user.official === 1 ? 'var(--accent)' : '#ffb027' }}
                      >
                        <Icon name="check" size={9} />
                      </span>
                    ) : null}
                    {hover.user.vip ? (
                      <span className="shrink-0 rounded-[2px] bg-[color-mix(in_oklab,var(--bili-pink)_12%,white)] px-1 text-[10px] leading-[15px] text-[var(--bili-pink)]">
                        大会员
                      </span>
                    ) : null}
                    {hover.user.mutual ? (
                      <span className="shrink-0 rounded-[2px] bg-[var(--panel-raised)] px-1 text-[10px] leading-[15px] text-[var(--text-3)]">
                        互关
                      </span>
                    ) : null}
                  </div>
                  {card ? (
                    <div className="num mt-1 flex items-center gap-3 whitespace-nowrap text-[12px] text-[var(--text-3)]">
                      <span>{formatCount(card.fans)} 粉丝</span>
                      <span>{formatCount(card.videos)} 投稿</span>
                    </div>
                  ) : null}
                  {card?.official ? (
                    <span className="mt-1 inline-block max-w-full truncate rounded-[2px] bg-[var(--accent-soft)] px-1 align-top text-[11px] leading-[16px] text-[var(--accent)]">
                      {card.official}
                    </span>
                  ) : null}
                </div>
              </div>
              {card?.sign || hover.user.sign ? (
                <p className="mt-2 line-clamp-2 text-[12px] leading-[18px] text-[var(--text-2)]">
                  {card?.sign || hover.user.sign}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
