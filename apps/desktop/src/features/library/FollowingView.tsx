import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useAppStore } from '../../app/appStore'
import type { Followed, Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatDuration } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import { useAuthStore } from '../auth/authStore'
import { useFollowingIndex } from './followingIndex'
import { useRetryAfterLogin } from './useRetryAfterLogin'

type Relation = 'all' | 'special' | 'mutual'

const RELATIONS: { key: Relation; label: string }[] = [
  { key: 'all', label: '全部关注' },
  { key: 'special', label: '特别关注' },
  { key: 'mutual', label: '互相关注' },
]

/** 从作品或空间页回来时，把这一屏原样交还给用户。 */
const followingMemory: {
  accountMid: number | null
  query: string
  relation: Relation
  selectedMid: number | null
  listTop: number
  detailTop: number
} = {
  accountMid: null,
  query: '',
  relation: 'all',
  selectedMid: null,
  listTop: 0,
  detailTop: 0,
}

function resetFollowingMemory(accountMid: number | null): void {
  followingMemory.accountMid = accountMid
  followingMemory.query = ''
  followingMemory.relation = 'all'
  followingMemory.selectedMid = null
  followingMemory.listTop = 0
  followingMemory.detailTop = 0
}

const worksCache = new Map<number, { tracks: Track[]; at: number }>()
const WORKS_TTL = 60_000

function AuthorMarks({ user }: { user: Followed }) {
  return (
    <>
      {user.special ? (
        <span
          title="特别关注"
          className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[#ffb027]"
        >
          <Icon name="star" size={12} />
        </span>
      ) : null}
      {user.official != null ? (
        <span
          title={user.official === 1 ? '机构认证' : '个人认证'}
          className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: user.official === 1 ? 'var(--accent)' : '#ffb027' }}
        >
          <Icon name="check" size={9} />
        </span>
      ) : null}
      {user.mutual ? (
        <span
          title="互相关注"
          className="shrink-0 rounded-[2px] bg-[var(--accent-soft)] px-1 text-[10px] leading-[15px] text-[var(--accent)]"
        >
          互关
        </span>
      ) : null}
    </>
  )
}

/**
 * 我关注的人。
 *
 * 只读：不做关注/取关，因为那会给真实 UP 主发通知。
 * 页首是跨全量关注的昵称/签名搜索，下面是关系筛选；宽窗左边名单、右边预览，
 * 窄窗先名单、点人再进预览。作品只取当前选中作者，打开后返回沿用 #212 的焦点约定。
 */
export function FollowingView() {
  const navigate = useAppStore((state) => state.navigate)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const auth = useAuthStore((state) => state.auth)
  const accountMid = auth?.user?.mid ?? null
  const authReady = auth !== null
  const index = useFollowingIndex(accountMid, authReady)
  const [query, setQuery] = useState('')
  const [relation, setRelation] = useState<Relation>('all')
  const [selectedMid, setSelectedMid] = useState<number | null>(null)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [booted, setBooted] = useState(false)
  const [worksView, setWorksView] = useState<{
    mid: number
    tracks: Track[] | null
    error: string | null
  }>({ mid: 0, tracks: null, error: null })
  const [worksAttempt, setWorksAttempt] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const pendingScroll = useRef<number | null>(null)

  useRetryAfterLogin(index.error, index.retry)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const sync = (): void => setWide(media.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!authReady) return
    if (!booted) {
      setBooted(true)
      if (followingMemory.accountMid === accountMid) {
        setQuery(followingMemory.query)
        setRelation(followingMemory.relation)
        setSelectedMid(followingMemory.selectedMid)
      } else {
        resetFollowingMemory(accountMid)
      }
      pendingScroll.current =
        followingMemory.selectedMid != null && !wide
          ? followingMemory.detailTop
          : followingMemory.listTop
      return
    }
    if (followingMemory.accountMid !== accountMid) {
      resetFollowingMemory(accountMid)
      setQuery('')
      setRelation('all')
      setSelectedMid(null)
      pendingScroll.current = 0
    }
  }, [authReady, accountMid, booted, wide])

  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (needle.length === 0) return index.items
    return index.items.filter(
      (user) =>
        user.name.toLowerCase().includes(needle) || user.sign.toLowerCase().includes(needle),
    )
  }, [index.items, needle])
  const filtered = useMemo(() => {
    if (relation === 'all') return matches
    if (relation === 'special') return matches.filter((user) => user.special)
    return matches.filter((user) => user.mutual)
  }, [matches, relation])
  const selected = index.items.find((user) => user.mid === selectedMid) ?? null
  const selectedVisible = selectedMid == null || filtered.some((user) => user.mid === selectedMid)
  const firstMatch = filtered[0] ?? null

  useEffect(() => {
    if (selectedMid != null && !selectedVisible) {
      setSelectedMid(null)
      followingMemory.selectedMid = null
    }
  }, [selectedMid, selectedVisible])

  // 宽窗没有选中项时，等筛选稳定后落到第一位；在键入过程中不反复取作品。
  useEffect(() => {
    if (!booted || !wide || selectedMid != null || firstMatch == null) return
    const timer = window.setTimeout(() => {
      setSelectedMid(firstMatch.mid)
      followingMemory.selectedMid = firstMatch.mid
    }, 250)
    return () => window.clearTimeout(timer)
  }, [booted, wide, selectedMid, firstMatch])

  const selectedId = selected?.mid ?? null
  useEffect(() => {
    if (selectedId == null) {
      setWorksView({ mid: 0, tracks: null, error: null })
      return
    }
    const cached = worksCache.get(selectedId)
    setWorksView({ mid: selectedId, tracks: cached?.tracks ?? null, error: null })
    if (cached && Date.now() - cached.at < WORKS_TTL) return
    let cancelled = false
    void ipc
      .spaceVideos(selectedId, 1, 'pubdate')
      .then(([list]) => {
        if (cancelled) return
        const owned = list.filter((track) => track.up_mid === selectedId).slice(0, 6)
        worksCache.set(selectedId, { tracks: owned, at: Date.now() })
        setWorksView({ mid: selectedId, tracks: owned, error: null })
      })
      .catch((cause) => {
        if (cancelled) return
        setWorksView((current) => ({
          mid: selectedId,
          tracks: current.mid === selectedId ? current.tracks : [],
          error: toWireError(cause).message,
        }))
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, worksAttempt])

  useLayoutEffect(() => {
    if (!booted || index.loading || pendingScroll.current === null) return
    const box = boxRef.current
    if (!box) return
    box.scrollTop = pendingScroll.current
    pendingScroll.current = null
  }, [booted, index.loading, index.items.length, selectedMid, wide])

  if (!authReady) return <BiliLoader label="正在取关注…" />

  if (index.error && index.items.length === 0) {
    const action =
      index.error.class === 'needs_login'
        ? { label: '去登录', onClick: () => setAuthOpen(true) }
        : index.error.class === 'retryable'
          ? { label: '重试', onClick: index.retry }
          : null
    return (
      <EmptyState icon="user" title="关注列表没取到" detail={index.error.message} action={action} />
    )
  }

  if (index.items.length === 0 && index.loading) {
    return <BiliLoader label="正在取关注…" />
  }

  if (index.complete && index.total === 0 && index.items.length === 0) {
    return (
      <EmptyState
        icon="user"
        title="还没有关注任何人"
        detail="在观看页点 UP 主名字进主页，那里可以关注。"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  const changeQuery = (value: string): void => {
    setQuery(value)
    followingMemory.query = value
  }
  const changeRelation = (value: Relation): void => {
    setRelation(value)
    followingMemory.relation = value
  }
  const clearFilters = (): void => {
    changeQuery('')
    changeRelation('all')
  }
  const pick = (mid: number): void => {
    if (mid === selectedMid) return
    if (!wide) {
      followingMemory.listTop = boxRef.current?.scrollTop ?? followingMemory.listTop
      followingMemory.detailTop = 0
      pendingScroll.current = 0
    }
    setSelectedMid(mid)
    followingMemory.selectedMid = mid
  }
  const backToList = (): void => {
    followingMemory.detailTop = boxRef.current?.scrollTop ?? followingMemory.detailTop
    pendingScroll.current = followingMemory.listTop
    setSelectedMid(null)
    followingMemory.selectedMid = null
  }
  const openSpace = (user: Followed): void => {
    followingMemory.listTop = boxRef.current?.scrollTop ?? followingMemory.listTop
    if (!wide) followingMemory.detailTop = boxRef.current?.scrollTop ?? 0
    navigate(
      { kind: 'author', name: user.name, mid: user.mid },
      undefined,
      `following-space:${user.mid}`,
    )
  }
  const openWork = (track: Track): void => {
    followingMemory.listTop = boxRef.current?.scrollTop ?? followingMemory.listTop
    if (!wide) followingMemory.detailTop = boxRef.current?.scrollTop ?? 0
    navigate({ kind: 'watch', track }, undefined, `following-work:${track.key}`)
  }

  const allCount = needle.length > 0 ? matches.length : Math.max(index.total, index.items.length)
  const counts: Record<Relation, number> = {
    all: allCount,
    special: matches.filter((user) => user.special).length,
    mutual: matches.filter((user) => user.mutual).length,
  }
  const works = selected != null && worksView.mid === selected.mid ? worksView.tracks : null
  const worksError = selected != null && worksView.mid === selected.mid ? worksView.error : null
  const nameCounts = new Map<string, number>()
  for (const user of index.items) nameCounts.set(user.name, (nameCounts.get(user.name) ?? 0) + 1)
  const progressText = index.loading
    ? index.total > 0
      ? `正在检索，已读 ${index.items.length} / ${index.total}`
      : '正在检索…'
    : `已读 ${index.items.length} / ${index.total}${index.failedPage ? `，第 ${index.failedPage} 页没取到` : ''}`
  const emptyText = !index.complete
    ? '已读范围内暂无匹配'
    : needle.length > 0
      ? '没有匹配的作者'
      : relation === 'special'
        ? '没有特别关注的作者'
        : relation === 'mutual'
          ? '没有互相关注的作者'
          : '没有可显示的作者'

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-following-author]') ?? []),
    ]
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : at + (event.key === 'ArrowDown' ? 1 : -1)
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus()
  }

  return (
    <div
      ref={boxRef}
      id="scroll-main"
      data-following-directory
      data-following-account={accountMid ?? ''}
      data-following-loaded={index.items.length}
      data-following-total={index.total}
      onScroll={() => {
        const box = boxRef.current
        if (!box) return
        if (selectedMid != null && !wide) followingMemory.detailTop = box.scrollTop
        else followingMemory.listTop = box.scrollTop
      }}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
    >
      <PageTitle
        extra={index.total > 0 ? formatCount(index.total) : undefined}
        action={
          <button
            type="button"
            aria-label="刷新关注列表"
            title="刷新关注列表"
            disabled={accountMid == null || index.loading}
            onClick={index.refresh}
            className="t press flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)] disabled:opacity-40"
          >
            <Icon name="refresh" size={14} />
          </button>
        }
      >
        我关注的人
      </PageTitle>

      <div className="mb-4">
        <label className="relative flex h-9 w-full max-w-[480px] items-center rounded-[6px] border border-[var(--line)] bg-[var(--panel)] focus-within:border-[var(--accent)]">
          <Icon name="search" size={15} className="ml-3 shrink-0 text-[var(--text-3)]" />
          <input
            data-following-search
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                changeQuery('')
              }
            }}
            placeholder="在我的关注中搜索"
            aria-label="在我的关注中搜索"
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => changeQuery('')}
              className="t press mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)]"
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="关注关系">
          {RELATIONS.map((item) => {
            const active = relation === item.key
            const partial = !index.complete && (item.key !== 'all' || needle.length > 0)
            return (
              <button
                key={item.key}
                type="button"
                data-following-filter={item.key}
                aria-pressed={active}
                onClick={() => changeRelation(item.key)}
                className={`t press rounded-[4px] px-3 py-1 text-[13px] ${
                  active
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-3)] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)]'
                }`}
              >
                {item.label}
                <span className={`num ml-1 text-[11px] ${active ? 'text-white' : 'text-[var(--text-3)]'}`}>
                  {formatCount(counts[item.key])}
                  {partial ? '+' : ''}
                </span>
              </button>
            )
          })}
        </div>

        {!index.complete ? (
          <div
            data-following-progress
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-3)]"
          >
            <span className="num">{progressText}</span>
            {index.failedPage ? (
              <button
                type="button"
                onClick={index.retry}
                className="t press text-[var(--accent)] hover:underline"
              >
                继续检索
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={
          selected ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6' : ''
        }
      >
        {/* 长签名会把 grid item 的最小宽度撑开，压到右侧预览下面；显式允许它收窄。 */}
        <div className={`min-w-0 ${selected && !wide ? 'hidden' : ''}`}>
          {filtered.length > 0 ? (
            <ul ref={listRef} className="grid min-w-0 gap-1.5">
              {filtered.map((user, at) => {
                const active = user.mid === selectedMid
                const ambiguous = (nameCounts.get(user.name) ?? 0) > 1
                const compact = !user.sign && !ambiguous
                return (
                  <li key={user.mid} className="min-w-0">
                    <button
                      type="button"
                      data-following-author={user.mid}
                      data-focus-id={`following:${user.mid}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => pick(user.mid)}
                      onKeyDown={(event) => onRowKeyDown(event, at)}
                      className={[
                        // 名单是连续的行，不是一张张卡片：整行只改底色，选中行加左侧标记。
                        'group flex w-full min-w-0 items-center gap-3 rounded-[6px] px-3 text-left',
                        compact ? 'py-2' : 'py-2.5',
                        active
                          ? 'bg-[var(--accent-soft)] shadow-[inset_2px_0_0_var(--accent)]'
                          : 'hover:bg-[var(--panel)]',
                      ].join(' ')}
                    >
                      <Avatar src={user.face} alt={user.name} size={compact ? 38 : 44} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[14px] font-medium text-[var(--text-1)]" title={user.name}>
                            {user.name}
                          </span>
                          <AuthorMarks user={user} />
                        </span>
                        {user.sign || ambiguous ? (
                          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-3)]">
                            {user.sign ? <span className="truncate">{user.sign}</span> : null}
                            {ambiguous ? <span className="num shrink-0">UID {user.mid}</span> : null}
                          </span>
                        ) : null}
                      </span>
                      <Icon
                        name="chevronRight"
                        size={16}
                        className="shrink-0 text-[var(--ga3)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
                      />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <p className="text-[14px] text-[var(--text-2)]">{emptyText}</p>
              {query.length > 0 || relation !== 'all' ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="t press mt-3 text-[13px] text-[var(--accent)] hover:underline"
                >
                  清除筛选
                </button>
              ) : null}
            </div>
          )}
        </div>

        {selected ? (
          <aside
            data-following-preview
            data-author-mid={selected.mid}
            className="min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--panel)] p-4 lg:sticky lg:top-4"
          >
            {!wide ? (
              <button
                type="button"
                data-following-back
                onClick={backToList}
                className="t mb-3 flex items-center gap-1 text-[13px] text-[var(--text-3)] hover:text-[var(--text-1)]"
              >
                <Icon name="chevronLeft" size={14} />
                返回列表
              </button>
            ) : null}
            <div className="flex min-w-0 items-start gap-3">
              <Avatar src={selected.face} alt={selected.name} size={64} />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="truncate text-[19px] font-semibold text-[var(--text-1)]" title={selected.name}>
                    {selected.name}
                  </h2>
                  <AuthorMarks user={selected} />
                </div>
                <p className="num mt-1 text-[12px] text-[var(--text-3)]">UID {selected.mid}</p>
                {selected.sign ? (
                  <p className="mt-2 line-clamp-3 break-words text-[13px] leading-relaxed text-[var(--text-2)]">
                    {selected.sign}
                  </p>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              data-following-space
              data-focus-id={`following-space:${selected.mid}`}
              onClick={() => openSpace(selected)}
              className="t press mt-3 flex h-8 w-full items-center justify-center gap-1 rounded-[6px] border border-[var(--line)] text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              进入空间
              <Icon name="chevronRight" size={13} />
            </button>

            <div className="mt-4 border-t border-hairline pt-3">
              <h3 className="text-[13px] font-medium text-[var(--text-1)]">近期投稿</h3>
              {works === null ? (
                <BiliLoader compact label="正在取投稿…" />
              ) : works.length === 0 ? (
                <div className="flex flex-col items-center py-5 text-center">
                  <p className="text-[12px] text-[var(--text-3)]">
                    {worksError ? '近期投稿没取到' : '暂无近期投稿'}
                  </p>
                  {worksError ? (
                    <button
                      type="button"
                      onClick={() => setWorksAttempt((value) => value + 1)}
                      className="t press mt-2 text-[12px] text-[var(--accent)] hover:underline"
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              ) : (
                <ul className="mt-2 grid grid-cols-2 gap-3">
                  {works.map((track) => (
                    <li key={track.key}>
                      <button
                        type="button"
                        data-following-work={track.key}
                        data-following-work-mid={track.up_mid ?? ''}
                        data-focus-id={`following-work:${track.key}`}
                        aria-label={`观看 ${track.title}`}
                        onClick={() => openWork(track)}
                        className="group block w-full text-left"
                      >
                        <span className="relative block aspect-video overflow-hidden rounded-[6px] border border-[var(--line)]">
                          <Cover cover={track.cover} title={track.title} width={220} className="h-full w-full" />
                          <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/60 px-1 text-[10px] leading-[15px] text-white">
                            {formatDuration(track.duration_ms)}
                          </span>
                        </span>
                        <span className="mt-1.5 line-clamp-2 text-[13px] leading-[19px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                          {track.title}
                        </span>
                        <span className="num mt-0.5 block text-[11px] text-[var(--text-3)]">
                          {formatCount(track.views ?? 0)} 播放
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(works?.length ?? 0) > 0 && worksError ? (
                <button
                  type="button"
                  onClick={() => setWorksAttempt((value) => value + 1)}
                  className="t press mt-2 text-[12px] text-[var(--accent)] hover:underline"
                >
                  重新取投稿
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
