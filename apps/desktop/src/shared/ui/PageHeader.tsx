import type { ReactNode } from 'react'

type PageHeaderProps = {
  eyebrow: string
  title: string
  subtitle: string | null
  actions: ReactNode | null
}

/** 标题与正文的间距统一走 4 的倍数：eyebrow→标题 8，标题→说明 12。 */
export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-[0.24em] text-white/32">{eyebrow}</div>
        <h1
          className="mt-2 truncate font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.035em] text-white/94"
          title={title}
        >
          {title}
        </h1>
        {subtitle ? <p className="mt-3 max-w-xl text-[12.5px] leading-relaxed text-white/40">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pb-1">{actions}</div> : null}
    </header>
  )
}
