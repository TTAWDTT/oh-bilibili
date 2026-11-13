import { BiliTvMark } from './BiliTvMark'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { Mascot2233 } from './Mascot2233'

/** 官方 2233 娘贴纸。素材取自 B 站官方动态，不是手绘。 */
export type MascotPose = 'missYou' | 'peek' | 'coin' | 'cheer' | 'hug' | 'heart'

const MASCOT_SRC: Record<MascotPose, string> = {
  missYou: '/assets/2233-miss-you.png',
  peek: '/assets/2233-peek.png',
  coin: '/assets/2233-coin.png',
  cheer: '/assets/2233-cheer.png',
  hug: '/assets/2233-hug.png',
  heart: '/assets/2233-heart.png',
}

type EmptyStateProps = {
  /** 用官方 2233 贴纸代替图标；比通用图标更像 B 站。 */
  mascot?: MascotPose
  icon: IconName
  title: string
  detail?: string
  action: { label: string; onClick: () => void } | null
  compact?: boolean
}

/** 空态与错误态都必须给出下一步动作：没有 action 的空态只是一个死胡同。 */
export function EmptyState({ icon, mascot, title, detail, action, compact = false }: EmptyStateProps) {
  return (
    <div className={compact ? 'flex flex-col items-center px-4 py-10 text-center' : 'flex flex-col items-center px-3 py-16 text-center'}>
      {/* 整页空态用站娘站底。B 站的空态就是 22 娘/33 娘撑着，
          一行小字摆在半空的页面里像是内容丢了。 */}
      {mascot && !compact ? (
        <Mascot2233 height={132} className="opacity-95" />
      ) : mascot ? null : icon === 'biliTv' ? (
        <span className="text-[var(--accent)]">
          <BiliTvMark size={48} />
        </span>
      ) : (
        <Icon name={icon} size={22} className="text-[var(--text-2)]" />
      )}
      <h2 className="mt-3 flex items-center justify-center gap-1.5 text-[16px] font-medium text-[var(--text-1)]" title={title}>
        {mascot && compact ? (
          /* 这两张是 B 站的聊天表情，原生用法是 24–32px 挂在文字旁；
             放大成主插图就会露出方底、压过整页的克制感。 */
          <img
            src={MASCOT_SRC[mascot]}
            alt=""
            aria-hidden
            draggable={false}
            className="h-[26px] w-[26px] shrink-0 select-none object-contain mix-blend-multiply"
          />
        ) : null}
        {title}
      </h2>
      {detail ? (
        <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[var(--text-2)]">{detail}</p>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="t press mt-5 h-8 rounded-[4px] bg-[var(--accent)] px-4 text-[14px] text-white hover:opacity-90"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
