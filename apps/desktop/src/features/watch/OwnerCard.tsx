import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { WatchView as WatchData } from '../../shared/lib/contract'
import { formatCount } from '../../shared/lib/format'
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
  onFollow,
}: {
  data: WatchData
  card: ipc.AuthorCard | null
  followed: boolean | null
  onFollow: () => void
}) {
  const navigate = useAppStore((state) => state.navigate)
  const goAuthor = (): void => {
    navigate({ kind: 'author', name: data.owner, mid: data.owner_mid ?? null })
  }

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      <div className="flex items-start gap-3">
        <button type="button" onClick={goAuthor} aria-label={`看 ${data.owner} 的更多视频`} className="t shrink-0">
          <Avatar src={data.owner_avatar} alt={data.owner} size={48} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={goAuthor}
              title={`看 ${data.owner} 的更多视频`}
              className="t max-w-full truncate text-[14px] font-medium text-[var(--bili-pink)] hover:underline"
            >
              {data.owner}
            </button>
            {card ? <LevelBadge level={card.level} /> : null}
            {card?.vip ? (
              <span className="shrink-0 rounded-[2px] bg-[color-mix(in_oklab,var(--bili-pink)_12%,white)] px-1 text-[10px] leading-[15px] text-[var(--bili-pink)]">
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
      {data.owner_mid ? (
        <button
          type="button"
          aria-pressed={followed === true}
          onClick={onFollow}
          className={`t press h-8 rounded-[4px] text-[13px] ${
            followed === true
              ? 'border border-[var(--line)] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              : 'bg-[var(--accent)] text-white hover:opacity-90'
          }`}
        >
          {followed === true ? '已关注' : `+ 关注 ${card ? formatCount(card.fans) : ''}`.trim()}
        </button>
      ) : null}
    </div>
  )
}
