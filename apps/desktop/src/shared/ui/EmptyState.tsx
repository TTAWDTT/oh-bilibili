import { BiliTvArt } from './BiliTvArt'
import { Icon } from './Icon'
import type { IconName } from './Icon'

type EmptyStateProps = {
  icon: IconName
  title: string
  detail: string
  action: { label: string; onClick: () => void } | null
  compact?: boolean
}

/** 空态与错误态都必须给出下一步动作：没有 action 的空态只是一个死胡同。 */
export function EmptyState({ icon, title, detail, action, compact = false }: EmptyStateProps) {
  return (
    <div className={compact ? 'flex flex-col items-center px-4 py-10 text-center' : 'flex flex-col items-center px-3 py-16 text-center'}>
      {icon === 'biliTv' ? (
        <span className="text-[var(--accent)]">
          <BiliTvArt />
        </span>
      ) : (
        <Icon name={icon} size={22} className="text-[var(--text-2)]" />
      )}
      <h3 className="mt-3 text-[16px] font-medium text-[var(--text-1)]" title={title}>
        {title}
      </h3>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[var(--text-2)]">{detail}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="t press mt-5 rounded-[4px] border border-[var(--line)] h-8 px-4 text-[14px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--text-1)]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
