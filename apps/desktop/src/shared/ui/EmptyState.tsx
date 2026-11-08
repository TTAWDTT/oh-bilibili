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
      <Icon name={icon} size={22} className="text-white/48" />
      <h3 className="mt-3 text-[14px] font-medium text-white/85" title={title}>
        {title}
      </h3>
      <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-white/62">{detail}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="t press mt-5 rounded-[4px] border border-white/32 px-4 py-2 text-[12px] text-white/85 hover:border-white/45 hover:text-white"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
