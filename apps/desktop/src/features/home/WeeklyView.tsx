import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { useAppStore } from '../../app/appStore'
import { WideCard } from '../tracks/WideCard'
import { HotPageHeader } from './HotPageHeader'

/** 换期记在模块里：打开作品再返回、去别的频道再回来，都还停在读过的那一期。 */
const weeklyMemory: { number: number | null } = { number: null }

/**
 * 每周必看。B 站自己按周出的片单：一期一个主题，一次 50 条。
 *
 * 期数列表是公开接口；某一期的片单要走 wbi 签名，没签名会回 -352。
 */
export function WeeklyView() {
  const [issues, setIssues] = useState<ipc.WeeklyIssue[] | null>(null)
  const [number, setNumber] = useState<number | null>(weeklyMemory.number)
  const [page, setPage] = useState<ipc.WeeklyPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [periodNonce, setPeriodNonce] = useState(0)
  const [picking, setPicking] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  const navigate = useAppStore((state) => state.navigate)

  useEffect(() => {
    let cancelled = false
    setIssues(null)
    setError(null)
    void ipc
      .weeklyIssues()
      .then((list) => {
        if (cancelled) return
        setIssues(list)
        setNumber((current) => current ?? list[0]?.number ?? null)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  // 展开期数下拉时，把当前期滚到列表中间；400 多期，落在顶部等于又找一遍。
  useLayoutEffect(() => {
    if (!picking) return
    pickerRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'center' })
  }, [picking, number])

  // 打开下拉就把焦点交给当前期；用键盘选完后焦点回到触发按钮，才能接着换期。
  useEffect(() => {
    if (!picking) return
    pickerRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus({ preventScroll: true })
  }, [picking])

  useLayoutEffect(() => {
    if (picking || !restoreFocus.current) return
    restoreFocus.current = false
    triggerRef.current?.focus()
  }, [picking])

  // 点外面收起。用 pointerdown 而不是 click：点在列表里也算「里面」，晚一拍的 click 会重新展开。
  useEffect(() => {
    if (!picking) return
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node
      // 触发按钮自己交给 onClick 取反；这里再关一次会被紧接着的 click 重新打开。
      if (pickerRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setPicking(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [picking])

  useEffect(() => {
    if (number === null) return
    let cancelled = false
    setPage(null)
    setError(null)
    // 换一期等于换一份片单，停在上一期的滚动位置会像是「切了没反应」。
    scrollerRef.current?.scrollTo({ top: 0 })
    void ipc
      .weeklyIssue(number)
      .then((next) => {
        if (!cancelled) setPage(next)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [number, periodNonce])

  const index = issues && number !== null ? issues.findIndex((i) => i.number === number) : -1
  // 列表按新到旧排：下一期是更早的那一条，上一期是更新的那一条。
  const older = index >= 0 ? (issues?.[index + 1]?.number ?? null) : null
  const newer = index > 0 ? (issues?.[index - 1]?.number ?? null) : null
  const choose = (next: number | null): void => {
    setPicking(false)
    weeklyMemory.number = next
    setNumber(next)
  }

  return (
    <div ref={scrollerRef} id="scroll-main" className="min-h-0 flex-1 overflow-y-auto pb-10">
      {/* 换期组紧贴页标题，正文直接接当期作品，中间不再放跨频道入口。 */}
      <HotPageHeader active="weekly" title="每周必看">
        {issues && issues.length > 0 ? (
          <div className="flex items-center gap-1">
            {/* 左箭头回到更早的一期，右箭头往前一期：和时间方向一致，不是和横条的排法一致。 */}
            <button
              type="button"
              aria-label="上一期"
              title="上一期"
              disabled={older === null}
              onClick={() => choose(older)}
              className="t press flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <div className="relative shrink-0">
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setPicking((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown') return
                  event.preventDefault()
                  setPicking(true)
                }}
                aria-expanded={picking}
                aria-haspopup="listbox"
                className="t press flex h-8 items-center gap-1.5 rounded-[6px] text-[13px] text-[var(--text-1)] hover:text-[var(--accent)]"
              >
                <span className="font-medium">{page?.label || `第 ${number} 期`}</span>
                <Icon
                  name="chevronRight"
                  size={13}
                  className={`text-[var(--text-3)] transition-transform ${picking ? '-rotate-90' : 'rotate-90'}`}
                />
              </button>
              {picking ? (
                <div
                  ref={pickerRef}
                  role="listbox"
                  aria-label="选择期数"
                  onBlur={(event) => {
                    const next = event.relatedTarget as Node | null
                    // 点触发器时焦点会先离开弹层；这次点击由按钮自己收起，别在这里抢着关掉再被 click 打开。
                    if (event.currentTarget.contains(next) || triggerRef.current?.contains(next)) return
                    // Tab 离开弹层就收起；焦点已经往前走了，不要再抢回来。
                    setPicking(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      restoreFocus.current = true
                      setPicking(false)
                      return
                    }
                    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
                    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return
                    event.preventDefault()
                    const options = [
                      ...(pickerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
                    ]
                    const at = options.indexOf(document.activeElement as HTMLButtonElement)
                    const target =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? options.length - 1
                          : Math.min(options.length - 1, Math.max(0, at + step))
                    options[target]?.focus()
                    options[target]?.scrollIntoView({ block: 'nearest' })
                  }}
                  className="absolute left-0 top-9 z-30 max-h-[60vh] w-[260px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[8px] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                >
                  {issues.map((issue) => (
                    <button
                      key={issue.number}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={issue.number === number}
                      data-active={issue.number === number}
                      title={issue.name}
                      onClick={() => {
                        restoreFocus.current = true
                        choose(issue.number)
                      }}
                      className={`t flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--ga0)] ${
                        issue.number === number ? 'text-[var(--accent)]' : 'text-[var(--text-2)]'
                      }`}
                    >
                      <span className="w-[68px] shrink-0">第 {issue.number} 期</span>
                      <span className="num min-w-0 flex-1 truncate text-[12px] text-[var(--text-3)]">
                        {issue.name.replace(/^\d+第\d+期\s*/, '')}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="下一期"
              title="下一期"
              disabled={newer === null}
              onClick={() => choose(newer)}
              className="t press flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        ) : null}
      </HotPageHeader>

      <div className="px-4 md:px-8">
      {error ? (
        <EmptyState
          icon="alert"
          title="每周必看没取到"
          detail={error}
          action={{
            label: '重试',
            onClick: () => {
              // 期数列表与当前期都可能失败；一次重试把两边都重新拉一遍。
              setNonce((n) => n + 1)
              setPeriodNonce((n) => n + 1)
            },
          }}
        />
      ) : issues === null || (number !== null && page === null) ? (
        <BiliLoader label="正在取本期…" />
      ) : page && page.tracks.length > 0 ? (
        <div data-weekly-issue={number ?? ''} className="@container">
          {page.subject && page.subject !== page.label ? (
            <h3 className="mb-4 text-[26px] font-semibold leading-tight text-[var(--text-1)] @card:text-[36px]">
              {page.subject}
            </h3>
          ) : null}
          <div className="grid items-start gap-5 @card:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {page.tracks.slice(0, 3).map((track, index) => (
              <div key={track.key} className={index === 0 && page.tracks.length > 1 ? '@card:row-span-2' : ''}>
                <WideCard
                  track={track}
                  lead={index === 0}
                  note={page.notes[track.key] ?? null}
                  onOpen={() => navigate({ kind: 'watch', track }, undefined, `wide:${track.key}`)}
                />
              </div>
            ))}
          </div>
          {page.tracks.length > 3 ? (
            <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 border-t border-[var(--line)] pt-6 @card:grid-cols-2">
              {page.tracks.slice(3).map((track) => (
                <WideCard
                  key={track.key}
                  track={track}
                  note={page.notes[track.key] ?? null}
                  onOpen={() => navigate({ kind: 'watch', track }, undefined, `wide:${track.key}`)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState mascot="missYou" icon="biliTv" title="这一期暂时是空的" action={null} />
      )}
      </div>
    </div>
  )
}
