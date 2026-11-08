import type { ReactNode } from 'react'

type PageHeaderProps = {
  /** 只在需要交代上下文时给（比如歌单名）。导航已经说明了位置，不要再放副标题和描述。 */
  title?: string
  actions?: ReactNode | null
}

/** 页面顶部只保留一行：左侧上下文，右侧动作。空的时候整条不渲染。 */
export function PageHeader({ title, actions }: PageHeaderProps) {
  if (!title && !actions) return null
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-b border-hairline px-8">
      <div className="min-w-0 truncate text-[13px] text-[var(--text-2)]" title={title}>
        {title ?? ''}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
