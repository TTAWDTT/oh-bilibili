import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { PageTitle } from '../../shared/ui/PageTitle'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'

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
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)

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

  return (
    <div ref={scrollerRef} id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <PageTitle extra={issues ? `${issues.length} 期` : undefined}>每周必看</PageTitle>

      {issues && issues.length > 0 ? (
        <div className="-mt-2 mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {/* 一期一个按钮，几百个也只是按钮，不截断：B 站能一路翻回最早那期。 */}
          {issues.map((issue) => (
            <button
              key={issue.number}
              type="button"
              onClick={() => setNumber(issue.number)}
              aria-pressed={issue.number === number}
              title={issue.name}
              className={[
                't press shrink-0 rounded-[6px] px-3 py-1.5 text-[13px]',
                issue.number === number
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--panel-raised)] text-[var(--text-2)] hover:text-[var(--accent)]',
              ].join(' ')}
            >
              第 {issue.number} 期
            </button>
          ))}
        </div>
      ) : null}

      {page ? (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline pb-3">
          <h2 className="text-[18px] font-medium text-[var(--text-1)]">{page.subject}</h2>
          <span className="text-[12px] text-[var(--text-3)]">{page.label}</span>
        </div>
      ) : null}

      {error ? (
        <EmptyState
          icon="alert"
          title="每周必看没取到"
          detail={error}
          action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }}
        />
      ) : issues === null || (number !== null && page === null) ? (
        <CardGridSkeleton cards={10} />
      ) : page && page.tracks.length > 0 ? (
        <ContentGrid
          tracks={page.tracks}
          activeKey={snapshot?.track?.key ?? null}
          playing={snapshot?.phase === 'playing'}
        />
      ) : (
        <EmptyState icon="biliTv" title="这一期暂时是空的" action={null} />
      )}

      {number !== null && page === null && !error ? <BiliLoader compact label="正在取这一期…" /> : null}
    </div>
  )
}
