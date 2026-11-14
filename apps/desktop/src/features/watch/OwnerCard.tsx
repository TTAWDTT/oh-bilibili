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
              className="t max-w-full truncate text-[14px] font-medium text-[var(--accent)] hover:underline"
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
      {/*
       * B 站这一排是两颗等高的窄胶囊靠右：左边「充电」（粉色描边），右边关注（蓝色实心）。
       * 之前是一颗占满整行的按钮，右栏一窄就像一条横贯的色带，把下面的弹幕列表压住。
       */}
      {data.owner_mid ? (
        <div className="flex items-center justify-end gap-2">
          {/* 充电是 B 站的付费流程，客户端不替它走一遍；点开空间页由 B 站自己承接。 */}
          <button
            type="button"
            title="去 B 站给 UP 主充电"
            onClick={() => void ipc.openExternal(`https://space.bilibili.com/${data.owner_mid}`)}
            className="t press flex h-8 items-center gap-1 rounded-[4px] border border-[color-mix(in_oklab,var(--accent)_45%,white)] px-3 text-[13px] text-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_8%,white)]"
          >
            <Icon name="battery" size={14} />
            充电
          </button>
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
            {followed === true ? '已关注' : `+ 关注 ${card ? formatCount(card.fans) : ''}`.trim()}
          </button>
        </div>
      ) : null}
    </div>
  )
}
