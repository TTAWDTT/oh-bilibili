import type { MouseEvent } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Followed, WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount } from '../../shared/lib/format'
import { AuthorHoverCard, useAuthorHover } from '../../shared/ui/AuthorHoverCard'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { LevelBadge } from '../../shared/ui/LevelBadge'

/**
 * UP 主名片。B 站网页版把它放在右栏最上面：头像、名字、签名，下面一颗关注。
 * 窄屏没有右栏，这张卡会以同样的样子排在标签下面。
 */
export function OwnerCard({
  data,
  card,
  followed,
  fansDelta,
  onFollow,
  inline = false,
}: {
  data: WatchData
  card: ipc.AuthorCard | null
  followed: boolean | null
  fansDelta?: number
  onFollow: () => void
  /** 主栏那一行：头像、名字、粉丝数、关注按钮横排一行，不带竖排布局与大段签名。 */
  inline?: boolean
}) {
  const navigate = useAppStore((state) => state.navigate)
  const hover = useAuthorHover()
  const goAuthor = (): void => {
    navigate({ kind: 'author', name: data.owner, mid: data.owner_mid ?? null })
  }
  const ownerUser: Followed | null = data.owner_mid
    ? {
        mid: data.owner_mid,
        name: data.owner,
        face: data.owner_avatar,
        sign: card?.sign ?? '',
        official: card?.official_type ?? null,
        vip: card?.vip ?? false,
      }
    : null
  const hoverProps = ownerUser
    ? {
        onMouseEnter: (event: MouseEvent<HTMLButtonElement>) =>
          hover.show(ownerUser, event.currentTarget),
        onMouseLeave: hover.hide,
      }
    : {}
  const hoverCard = (
    <AuthorHoverCard
      hover={hover.hover}
      card={hover.card}
      onHide={hover.hide}
      onKeep={hover.keep}
      onOpen={(user) => navigate({ kind: 'author', name: user.name, mid: user.mid })}
    />
  )

  if (inline) {
    return (
      <div className="flex w-fit max-w-full flex-wrap items-center gap-3 py-1">
        <button
          type="button"
          onClick={goAuthor}
          aria-label={`看 ${data.owner} 的更多视频`}
          className="t shrink-0"
          {...hoverProps}
        >
          <Avatar src={data.owner_avatar} alt={data.owner} size={38} />
        </button>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={goAuthor}
              title={`看 ${data.owner} 的更多视频`}
              className="t max-w-[220px] truncate text-[14px] font-medium text-[var(--accent)] hover:underline"
              {...hoverProps}
            >
              {data.owner}
            </button>
            {card ? <LevelBadge level={card.level} /> : null}
            {card?.official_type != null ? (
              <span
                title={card.official ?? (card.official_type === 1 ? '机构认证' : '个人认证')}
                className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: card.official_type === 1 ? 'var(--accent)' : '#ffb027' }}
              >
                <Icon name="check" size={10} />
              </span>
            ) : null}
          </div>
          {/* 粉丝数是这一行里最有用的一格信息：B 站在名字右侧挂「N 粉丝」。 */}
          {card ? (
            <p className="num mt-0.5 text-[12px] text-[var(--text-3)]">
              {formatCount(Math.max(0, card.fans + (fansDelta ?? 0)))} 粉丝
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-pressed={followed === true}
          onClick={onFollow}
          className={`t press flex h-7 shrink-0 items-center rounded-[4px] px-3 text-[12.5px] ${
            followed === true
              ? 'border border-[var(--line)] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              : 'bg-[var(--accent)] text-white hover:opacity-90'
          }`}
        >
          {followed === true ? '已关注' : '关注'}
        </button>
        {hoverCard}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={goAuthor}
          aria-label={`看 ${data.owner} 的更多视频`}
          className="t shrink-0"
          {...hoverProps}
        >
          <Avatar src={data.owner_avatar} alt={data.owner} size={48} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={goAuthor}
              title={`看 ${data.owner} 的更多视频`}
              className="t max-w-full truncate text-[14px] font-medium text-[var(--accent)] hover:underline"
              {...hoverProps}
            >
              {data.owner}
            </button>
            {card ? <LevelBadge level={card.level} /> : null}
            {card?.vip ? (
              <span className="shrink-0 rounded-[2px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
                大会员
              </span>
            ) : null}
            {card?.official_type != null ? (
              <span
                title={card.official ?? (card.official_type === 1 ? '机构认证' : '个人认证')}
                className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: card.official_type === 1 ? 'var(--accent)' : '#ffb027' }}
              >
                <Icon name="check" size={10} />
              </span>
            ) : null}
          </div>
          {card?.sign ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-[var(--text-3)]">{card.sign}</p>
          ) : null}
        </div>
      </div>
      {/* 关注靠右一颗窄胶囊：占满整行的话，右栏一窄就像一条横贯的色带。 */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          aria-pressed={followed === true}
          onClick={onFollow}
          className={`t press flex h-8 items-center rounded-[4px] px-4 text-[13px] ${
            followed === true
              ? 'border border-[var(--line)] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              : 'bg-[var(--accent)] text-white hover:opacity-90'
          }`}
        >
          {followed === true
            ? '已关注'
            : `+ 关注 ${card ? formatCount(Math.max(0, card.fans + (fansDelta ?? 0))) : ''}`.trim()}
        </button>
      </div>
      {hoverCard}
    </div>
  )
}
