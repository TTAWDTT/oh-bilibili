import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Followed, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { AuthorHoverCard, useAuthorHover } from '../../shared/ui/AuthorHoverCard'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { PREFETCH_PX } from '../../shared/lib/prefetch'
import { useRetryAfterLogin } from './useRetryAfterLogin'

/**
 * 我关注的人。
 *
 * 只读：不做关注/取关，因为那会给真实 UP 主发通知。
 * 点一个进他的主页，和 B 站的空间页入口一致；悬停出名片，和 B 站关注列表一致。
 */
export function FollowingView() {
  const navigate = useAppStore((s) => s.navigate)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const [items, setItems] = useState<Followed[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<WireError | null>(null)
  const [done, setDone] = useState(false)
  /** 翻页没取到：停在已加载的人，链子别再自动往下撞。 */
  const [failed, setFailed] = useState(false)
  const authorHover = useAuthorHover()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(false)
  const loadingRef = useRef(false)
  const pageRef = useRef(0)

  const load = async (next: number): Promise<void> => {
    if (loadingRef.current || next <= pageRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const [list, count] = await ipc.following(next)
      if (!mountedRef.current) return
      setItems((prev) => (next === 1 ? list : [...prev, ...list]))
      setTotal(count)
      pageRef.current = next
      setPage(next)
      setFailed(false)
      // 每页 50 条（接口上限），到这里才知道是不是真到底
      if (list.length === 0 || next * 50 >= count) setDone(true)
    } catch (e) {
      if (!mountedRef.current) return
      // 第一页失败才是「关注列表没取到」；翻页失败只是这一段没取到，
      // 把已经拿到的人留在屏幕上，给个重试，别整页换成错误态。
      if (next === 1) setError(toWireError(e))
      else setFailed(true)
    } finally {
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    void load(1)
    return () => {
      mountedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = () => void load(1)
  useRetryAfterLogin(error, retry)

  // 取回一页后缓冲还不够深就继续取。关注列表常一页装不满窗口
  // （328 个关注、一屏能放 20 个），光靠滚动事件永远触发不了。
  useEffect(() => {
    const box = boxRef.current
    if (!box || page === 0 || done || failed) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < PREFETCH_PX) void load(page + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, done, loading, failed])

  if (error) {
    const action =
      error.class === 'needs_login'
        ? { label: '去登录', onClick: () => setAuthOpen(true) }
        : error.class === 'retryable'
          ? { label: '重试', onClick: retry }
          : null
    return (
      <EmptyState
        icon="user"
        title="关注列表没取到"
        detail={error.message}
        action={action}
      />
    )
  }

  if (page === 0 && loading) return <BiliLoader label="正在取关注…" />

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
      id="scroll-main"
      onScroll={() => {
        authorHover.hide()
        const box = boxRef.current
        if (box && !done && !failed && box.scrollHeight - box.scrollTop - box.clientHeight < PREFETCH_PX) {
          void load(page + 1)
        }
      }}
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
                onPointerEnter={(event) => authorHover.show(u, event.currentTarget)}
                onPointerLeave={authorHover.hide}
                onFocus={(event) => authorHover.show(u, event.currentTarget)}
                onBlur={authorHover.hide}
                className="bili-card group flex w-full items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--panel)] px-3 py-3 text-left hover:border-[var(--accent)]"
              >
                <Avatar src={u.face} alt={u.name} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium text-[var(--text-1)]">{u.name}</span>
                    {u.special ? (
                      <span
                        title="特别关注"
                        className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[#ffb027]"
                      >
                        <Icon name="star" size={12} />
                      </span>
                    ) : null}
                    {u.official != null ? (
                      <span
                        title={u.official === 1 ? '机构认证' : '个人认证'}
                        className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-white"
                        style={{ background: u.official === 1 ? 'var(--accent)' : '#ffb027' }}
                      >
                        <Icon name="check" size={9} />
                      </span>
                    ) : null}
                    {u.mutual ? (
                      <span className="shrink-0 rounded-[2px] bg-[var(--accent-soft)] px-1 text-[10px] leading-[15px] text-[var(--accent)]">
                        互关
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-[12px] text-[var(--text-3)]">
                    {u.sign || '这个人很神秘，什么都没写'}
                  </span>
                </span>
                <Icon
                  name="chevronRight"
                  size={16}
                  className="shrink-0 text-[var(--ga3)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
                />
              </button>
            </li>
          ))}
        </ul>
        {loading ? <BiliLoader compact label="正在取…" /> : null}
        {failed && !loading ? (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={() => void load(page + 1)}
              className="t press text-[12px] text-[var(--accent)] hover:underline"
            >
              没取到，重试
            </button>
          </div>
        ) : null}
        {done && items.length > 0 ? (
          <p className="py-3 text-center text-[11px] text-[var(--text-3)]">到底了</p>
        ) : null}
      </div>
      <AuthorHoverCard
        hover={authorHover.hover}
        card={authorHover.card}
        onHide={authorHover.hide}
        onKeep={authorHover.keep}
        onOpen={(user) => navigate({ kind: 'author', name: user.name, mid: user.mid })}
      />
    </div>
  )
}
