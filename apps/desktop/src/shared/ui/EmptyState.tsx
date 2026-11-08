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
    <div
      className={
        compact
          ? 'flex flex-col items-center px-4 py-8 text-center'
          : 'flex flex-col items-center px-6 py-16 text-center'
      }
    >
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/44">
        <Icon name={icon} size={22} />
        <span className="absolute inset-0 rounded-2xl shadow-[0_0_50px_-10px_var(--accent-soft)]" />
      </div>
      <h3 className="mt-4 text-[14px] font-medium text-white/84" title={title}>
        {title}
      </h3>
      <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-white/40">{detail}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="t press mt-5 rounded-full border border-white/14 bg-white/[0.06] px-4 py-2 text-[12px] text-white/84 hover:border-white/28 hover:bg-white/[0.12] hover:text-white"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
