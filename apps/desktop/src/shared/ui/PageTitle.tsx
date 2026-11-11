import type { ReactNode } from 'react'

/**
 * 页面标题。全站一个字号、一个行高。
 *
 * 之前发现页 17px、关注与稍后再看 15px、收藏夹 18px，每页都自己写一个 h2，
 * 换个页面标题就换一次大小，读起来像不同的应用。
 */
export function PageTitle({
  children,
  extra,
  action,
}: {
  children: ReactNode
  extra?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {/* 页面级 h1 由 App 提供（读屏用的隐藏标题），这里从 h2 起，标题层级不重复。 */}
      <h2 className="text-[17px] font-medium text-[var(--text-1)]">{children}</h2>
      {extra ? <span className="num self-baseline text-[12px] text-[var(--text-3)]">{extra}</span> : null}
      {action ? <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
