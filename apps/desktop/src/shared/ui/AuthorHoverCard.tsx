import { useEffect, useRef, useState } from 'react'
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
function popoverStyle(anchor: AuthorHover['anchor']): { left: number; top: number; width: number } {
  const width = 320
  const gap = 10
  let left = anchor.right + gap
  if (left + width > window.innerWidth - 8) left = anchor.left - width - gap
  if (left < 8) left = 8
  // 名片高约 236（头像行 + 签名两行 + 查看主页），留余量再夹进窗口，别让底部按钮掉出屏幕。
  const top = Math.min(Math.max(anchor.top, 8), Math.max(8, window.innerHeight - 244))
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
  if (!hover) return null
  return createPortal(
    <div
      role="tooltip"
      /* 名片本身可点：指针从卡片移进名片时不能收起来，否则里面的入口永远按不到 */
      onPointerEnter={onKeep}
      onPointerLeave={onHide}
      onFocus={onKeep}
      onBlur={onHide}
      className="fixed z-[60] rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
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
