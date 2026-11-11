import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Followed } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { EmptyState } from '../../shared/ui/EmptyState'
import { PageTitle } from '../../shared/ui/PageTitle'
import { TrackListSkeleton } from '../../shared/ui/Skeleton'

/**
 * 我关注的人。
 *
 * 只读：不做关注/取关，因为那会给真实 UP 主发通知。
 * 点一个进他的主页，和 B 站的空间页入口一致。
 */
export function FollowingView() {
  const navigate = useAppStore((s) => s.navigate)
  const [items, setItems] = useState<Followed[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const load = async (next: number): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [list, count] = await ipc.following(next)
      setItems((prev) => (next === 1 ? list : [...prev, ...list]))
      setTotal(count)
      setPage(next)
      if (list.length === 0 || (next * 20) >= count) setDone(true)
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onScroll = (): void => {
    const box = boxRef.current
    if (!box || loading || done) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 240) void load(page + 1)
  }

  if (error) {
    return (
      <EmptyState
        icon="user"
        title="关注列表没取到"
        detail={error}
        action={{ label: '去设置登录', onClick: () => navigate({ kind: 'settings' }) }}
      />
    )
  }

  if (page === 0 && loading) return <TrackListSkeleton rows={5} />

  if (done && items.length === 0) {
    return (
      <EmptyState
        icon="user"
        title="还没有关注任何人"
        detail="在观看页点 UP 主名字进主页，那里可以关注。"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  return (
    <div
      ref={boxRef}
      onScroll={onScroll}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <PageTitle extra={formatCount(total)}>我关注的人</PageTitle>
      <div>
        <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {items.map((u) => (
            <li key={u.mid}>
              <button
                type="button"
                onClick={() => navigate({ kind: 'author', name: u.name, mid: u.mid })}
                className="t press flex w-full items-center gap-2.5 rounded-[8px] border border-[var(--line)] px-2.5 py-2 text-left hover:bg-[var(--panel-alt)]"
              >
                {u.face ? (
                  <img
                    src={u.face}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-full bg-[var(--panel-alt)]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-[var(--text-1)]">{u.name}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-3)]">
                    {u.sign || '这个人很神秘，什么都没写'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {loading ? <p className="py-3 text-center text-[12px] text-[var(--text-3)]">正在取…</p> : null}
        {done && items.length > 0 ? (
          <p className="py-3 text-center text-[11px] text-[var(--text-3)]">到底了</p>
        ) : null}
      </div>
    </div>
  )
}
