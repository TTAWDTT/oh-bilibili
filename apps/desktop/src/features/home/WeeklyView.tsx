import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { useAppStore } from '../../app/appStore'
import { WideCard } from '../tracks/WideCard'
import { HotTabs } from './HotTabs'

/**
 * 每周必看。B 站自己按周出的片单：一期一个主题，一次 50 条。
 *
 * 期数列表是公开接口；某一期的片单要走 wbi 签名，没签名会回 -352。
 */
export function WeeklyView() {
  const [issues, setIssues] = useState<ipc.WeeklyIssue[] | null>(null)
  const [number, setNumber] = useState<number | null>(null)
  const [page, setPage] = useState<ipc.WeeklyPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [picking, setPicking] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
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

  // 点外面收起。用 pointerdown 而不是 click：点在列表里也算「里面」，晚一拍的 click 会重新展开。
  useEffect(() => {
    if (!picking) return
    const onDown = (event: PointerEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setPicking(false)
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
  }, [number])

  const index = issues && number !== null ? issues.findIndex((i) => i.number === number) : -1
  // 列表按新到旧排：下一期是更早的那一条，上一期是更新的那一条。
  const older = index >= 0 ? (issues?.[index + 1]?.number ?? null) : null
  const newer = index > 0 ? (issues?.[index - 1]?.number ?? null) : null

  return (
    <div ref={scrollerRef} id="scroll-main" className="min-h-0 flex-1 overflow-y-auto pb-10">
      {/*
       * B 站每周必看：白色 header 带里是「第 N 期(日期更新)」+ 一行更新时间，
       * 正文和热门、入站必刷一样是两列横排大卡，每张卡多一句 B 站写的推荐语。
       */}
      <HotTabs active="weekly" title="每周必看">
        {/* B 站这一带只有一行：左边「第399期(1113更新) ▾」，紧接着更新时间，右边是前后两期。 */}
        <div className="flex items-center gap-3">
          {issues && issues.length > 0 ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setPicking((open) => !open)}
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
                  className="absolute left-0 top-9 z-30 max-h-[60vh] w-[260px] overflow-y-auto rounded-[8px] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                >
                  {issues.map((issue) => (
                    <button
                      key={issue.number}
                      type="button"
                      role="option"
                      aria-selected={issue.number === number}
                      data-active={issue.number === number}
                      title={issue.name}
                      onClick={() => {
                        setNumber(issue.number)
                        setPicking(false)
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
          ) : null}
          {/* 398 期，下拉翻起来也慢；前后各给一个。 */}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {/* 左箭头回到更早的一期，右箭头往前一期：和时间方向一致，不是和横条的排法一致。 */}
            <button
              type="button"
              aria-label="上一期"
              title="上一期"
              disabled={older === null}
              onClick={() => setNumber(older)}
              className="t press flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <button
              type="button"
              aria-label="下一期"
              title="下一期"
              disabled={newer === null}
              onClick={() => setNumber(newer)}
              className="t press flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </span>
        </div>
      </HotTabs>

      <div className="px-4 md:px-8">
      {error ? (
        <EmptyState
          icon="alert"
          title="每周必看没取到"
          detail={error}
          action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }}
        />
      ) : issues === null || (number !== null && page === null) ? (
        <BiliLoader label="正在取本期…" />
      ) : page && page.tracks.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2">
          {page.tracks.map((track) => (
            <WideCard
              key={track.key}
              track={track}
              note={page.notes[track.key] ?? null}
              onOpen={() => navigate({ kind: 'watch', track })}
            />
          ))}
        </div>
      ) : (
        <EmptyState mascot="missYou" icon="biliTv" title="这一期暂时是空的" action={null} />
      )}
      </div>
    </div>
  )
}
