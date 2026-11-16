import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { Icon } from '../../shared/ui/Icon'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/**
 * 番剧更新表。B 站首页右下角那块「周一 … 周日」，是催番的人最常看的一栏。
 *
 * 接口给 13 天（6 前 + 6 后），这里只排一周：今天所在周的周一到周日。
 * 默认选今天，没有今天这一格就选第一个有更新的。
 */
export function BangumiTimeline() {
  const [days, setDays] = useState<ipc.BangumiDay[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void ipc
      .bangumiTimeline()
      .then((list) => {
        if (cancelled) return
        setDays(list)
        const today = list.find((d) => d.today)
        setPicked(today?.weekday ?? list.find((d) => d.episodes.length > 0)?.weekday ?? 1)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error || !days || days.length === 0) return null

  // 接口给的是 6 天前到 6 天后。直接按 weekday 取第一条会拿到上周三到周日，
  // 所以从今天往回退到本周一，再连续取 7 天。
  const todayIndex = days.findIndex((day) => day.today)
  const today = todayIndex >= 0 ? days[todayIndex] : undefined
  const start = today ? Math.max(0, todayIndex - (today.weekday - 1)) : 0
  const week = days.slice(start, start + 7)
  const byWeekday = new Map<number, ipc.BangumiDay>()
  for (const day of week) byWeekday.set(day.weekday, day)
  const active = picked !== null ? byWeekday.get(picked) : undefined

  return (
    <section className="mb-5 overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <h3 className="text-[14px] font-medium text-[var(--text-1)]">番剧更新表</h3>
        <button
          type="button"
          onClick={() => void ipc.openExternal('https://www.bilibili.com/anime/timeline').catch(() => {})}
          className="t press flex items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          完整时间表
          <Icon name="chevronRight" size={12} />
        </button>
      </div>
      <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto px-3">
        {WEEKDAYS.map((label, i) => {
          const weekday = i + 1
          const day = byWeekday.get(weekday)
          const isActive = picked === weekday
          return (
            <button
              key={weekday}
              type="button"
              onClick={() => setPicked(weekday)}
              disabled={!day}
              className={[
                't press flex shrink-0 flex-col items-center rounded-[6px] px-3 py-1.5 text-[12.5px]',
                isActive
                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                  : day
                    ? 'text-[var(--text-2)] hover:bg-[var(--ga0)]'
                    : 'cursor-default text-[var(--text-3)] opacity-50',
              ].join(' ')}
            >
              <span>{label}</span>
              <span className="num text-[11px] text-[var(--text-3)]">{day?.date ?? '—'}</span>
            </button>
          )
        })}
      </div>
      {/* 换成可换行的网格：一天四部时横向排会右侧留一大片白，和上面的周标签也不对齐 */}
      <div className="mt-1 grid gap-x-4 gap-y-2 px-4 pb-4 [grid-template-columns:repeat(auto-fill,minmax(212px,1fr))]">
        {active && active.episodes.length > 0 ? (
          active.episodes.map((ep) => (
            <button
              key={`${ep.season_id}-${ep.pub_index}`}
              type="button"
              onClick={() => void ipc.openExternal(ep.url).catch(() => {})}
              title={ep.title}
              className="group flex min-w-0 items-center gap-2.5 text-left"
            >
              <span className="h-[52px] w-[40px] shrink-0 overflow-hidden rounded-[4px] bg-[var(--ga1)]">
                {ep.cover ? (
                  <img
                    src={ep.cover}
                    alt=""
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-[13px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                  {ep.title}
                </span>
                <span className="num mt-0.5 line-clamp-1 text-[11.5px] text-[var(--text-3)]">
                  {ep.pub_time ? `${ep.pub_time} ` : ''}
                  {ep.pub_index}
                </span>
              </span>
            </button>
          ))
        ) : (
          <p className="py-2 text-[12.5px] text-[var(--text-3)]">这一天没有更新</p>
        )}
      </div>
    </section>
  )
}
