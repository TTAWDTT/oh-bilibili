import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import { Icon } from '../../shared/ui/Icon'
import { HOT_CHANNELS, type HotChannel } from '../../shared/lib/biliChannels'

/** 窄窗用选择器换页会让整页重挂，焦点先记在模块里，新页挂载时再交给它的选择器。 */
let focusChannelSelect = false

/**
 * 四个热门频道共用的页首：标题、右侧操作和可选的第二行（排行榜分区）。
 *
 * 左栏存在时频道切换只由左栏负责；只有窄窗左栏收起时才在标题旁放出选择器。
 */
export function HotPageHeader({
  active,
  title,
  extra,
  aside,
  children,
  below,
}: {
  active: HotChannel
  title: string
  extra?: string | undefined
  aside?: ReactNode
  /** 紧邻标题的控件（每周必看的换期组）。 */
  children?: ReactNode
  /** 标题行下面的一行分区（排行榜）。 */
  below?: ReactNode
}) {
  const navigate = useAppStore((state) => state.navigate)
  const selectRef = useRef<HTMLSelectElement | null>(null)

  useEffect(() => {
    if (!focusChannelSelect) return
    focusChannelSelect = false
    // 桌面没有这个选择器，别把焦点塞给隐藏控件。
    if (window.matchMedia('(max-width: 767px)').matches) selectRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <header
      className={`mb-4 bg-[var(--panel)] px-4 pt-4 md:px-8 ${below ? '' : 'pb-3'}`}
      data-hot-page={active}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[20px] font-medium leading-[28px] text-[var(--text-1)]">{title}</h2>
          {extra ? <span className="num text-[12px] text-[var(--text-3)]">{extra}</span> : null}
        </div>
        {children ? (
          <div className="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-2 md:col-span-1 md:col-start-2 md:row-start-1">
            {children}
          </div>
        ) : null}
        <div className="col-start-2 row-start-1 flex items-center justify-end gap-3 md:col-start-3">
          {aside}
          <span className="relative md:hidden">
            <select
              ref={selectRef}
              data-hot-channel-select
              aria-label="切换频道"
              value={active}
              onChange={(event) => {
                const next = event.target.value as HotChannel
                if (next === active) return
                focusChannelSelect = true
                navigate({ kind: next })
              }}
              className="t h-8 appearance-none rounded-[6px] border border-[var(--line)] bg-[var(--panel)] pl-2.5 pr-7 text-[12px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {HOT_CHANNELS.map((channel) => (
                <option key={channel.view} value={channel.view}>
                  {channel.label}
                </option>
              ))}
            </select>
            <Icon
              name="chevronRight"
              size={12}
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-[var(--text-3)]"
            />
          </span>
        </div>
      </div>
      {below}
    </header>
  )
}
