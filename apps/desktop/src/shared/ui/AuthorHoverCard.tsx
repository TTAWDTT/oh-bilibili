import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Followed } from '../lib/contract'
import { formatCount } from '../lib/format'
import * as ipc from '../lib/ipc'
import type { AuthorCard } from '../lib/ipc'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { LevelBadge } from './LevelBadge'

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

export type AuthorHover = {
  user: Followed
  anchor: { top: number; left: number; right: number }
}

/** 名片贴在被悬停的头像右侧；右边放不下就翻到左侧，再夹进窗口。 */
function popoverStyle(
  anchor: AuthorHover['anchor'],
  height: number,
): { left: number; top: number; width: number } {
  const width = 320
  const gap = 10
  let left = anchor.right + gap
  if (left + width > window.innerWidth - 8) left = anchor.left - width - gap
  if (left < 8) left = 8
  // 用渲染后的真实高度夹进窗口：资料晚到、签名多一行时高度会变，
  // 按固定估值算会让底部的「查看主页」掉出屏幕（#247）。
  const top = Math.min(Math.max(anchor.top, 8), Math.max(8, window.innerHeight - height - 8))
  return { left, top, width }
}

export function useAuthorHover(): {
  hover: AuthorHover | null
  card: AuthorCard | undefined
  show: (user: Followed, el: HTMLElement) => void
  hide: () => void
  keep: () => void
} {
  const [hover, setHover] = useState<AuthorHover | null>(null)
  const [loaded, setLoaded] = useState<Record<number, AuthorCard>>({})
  const timerRef = useRef<number | null>(null)

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

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

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
    // 指针从头像移进名片要经过一小段空隙，立刻卸载会让名片永远点不到。
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setHover(null)
    }, 120)
  }

  const keep = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  return { hover, card: hover ? loaded[hover.user.mid] : undefined, show, hide, keep }
}

export function AuthorHoverCard({
  hover,
  card,
  onHide,
  onKeep,
  onOpen,
}: {
  hover: AuthorHover | null
  card: AuthorCard | undefined
  onHide: () => void
  onKeep: () => void
  onOpen: (user: Followed) => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  /** 真实高度；资料晚到时重新量，位置跟着重算。 */
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const measure = (): void => setHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hover?.user.mid, card])

  if (!hover) return null
  return createPortal(
    <div
      ref={panelRef}
      role="tooltip"
      /* 名片本身可点：指针从卡片移进名片时不能收起来，否则里面的入口永远按不到 */
      onPointerEnter={onKeep}
      onPointerLeave={onHide}
      onFocus={onKeep}
      onBlur={onHide}
      className="fixed z-[60] rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
      style={popoverStyle(hover.anchor, height || 244)}
    >
      <div className="flex items-start gap-2.5">
        <Avatar src={hover.user.face} alt={hover.user.name} size={48} />
        <div className="min-w-0 flex-1">
          {/* 首行只放昵称与认证：长中文名允许两行，不能被等级和会员先挤掉。
              等级、会员这些身份留到粉丝那一组旁边，空间不足时才换行。 */}
          <div className="flex min-w-0 items-start gap-1.5">
            <span
              className="line-clamp-2 min-w-0 break-words text-[15px] font-medium leading-[21px] text-[var(--text-1)]"
              title={hover.user.name}
            >
              {hover.user.name}
            </span>
            {hover.user.official != null ? (
              <span
                title={hover.user.official === 1 ? '机构认证' : '个人认证'}
                className="mt-[3px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: hover.user.official === 1 ? 'var(--accent)' : '#ffb027' }}
              >
                <Icon name="check" size={9} />
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
            {card ? <LevelBadge level={card.level} /> : null}
            {hover.user.vip ? (
              <span className="shrink-0 rounded-[2px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
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
      <button
        type="button"
        onClick={() => onOpen(hover.user)}
        className="t press mt-2.5 flex w-full items-center justify-center gap-1 rounded-[4px] border border-[var(--accent)] py-1 text-[12px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
      >
        查看主页
        <Icon name="chevronRight" size={12} />
      </button>
    </div>,
    document.body,
  )
}
