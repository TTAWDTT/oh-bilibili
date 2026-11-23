import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAppStore } from './appStore'
import { useAuthStore } from '../features/auth/authStore'
import { Avatar } from '../shared/ui/Avatar'
import * as ipc from '../shared/lib/ipc'
import type { HotSearchItem } from '../shared/lib/ipc'
import { toastFailure } from './notice'
import { isMacOS, isTauri } from '../shared/lib/runtime'
import { useWindowDrag } from '../shared/lib/useWindowDrag'
import { Icon, type IconName } from '../shared/ui/Icon'
import { useSearchHistory } from '../shared/lib/searchHistory'
import { AnchoredPanel } from '../shared/ui/AnchoredPanel'
import type { Anchor } from '../shared/ui/AnchoredPanel'
import { LevelBadge } from '../shared/ui/LevelBadge'

const overlayTitleBar = isTauri && isMacOS

const EXTERNAL_SITES: { label: string; icon: IconName; url: string }[] = [
  { label: '游戏中心', icon: 'game', url: 'https://game.bilibili.com/' },
  { label: '会员购', icon: 'gift', url: 'https://show.bilibili.com/' },
  { label: '漫画', icon: 'article', url: 'https://manga.bilibili.com/' },
  { label: '赛事', icon: 'rank', url: 'https://www.bilibili.com/v/game/match/' },
]

/**
 * 顶栏搜索框下面的建议面板。
 *
 * 空输入显示历史与热搜，输入后显示当前词和真实联想词。
 */
function SearchSuggest({ query, onPick }: { query: string; onPick: (word: string) => void }) {
  const history = useSearchHistory((state) => state.items)
  const clear = useSearchHistory((state) => state.clear)
  const [trending, setTrending] = useState<HotSearchItem[]>([])
  const [suggestions, setSuggestions] = useState<{ query: string; terms: string[] }>({ query: '', terms: [] })
  const trimmed = query.trim()

  const moveInPanel = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0)
    buttons[next]?.focus()
  }

  useEffect(() => {
    setSuggestions({ query: trimmed, terms: [] })
    if (!trimmed) return
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void ipc.searchSuggest(trimmed)
        .then((terms) => {
          if (!cancelled) setSuggestions({ query: trimmed, terms })
        })
        .catch(() => {})
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [trimmed])

  useEffect(() => {
    let cancelled = false
    void ipc
      .hotSearch()
      .then((list) => {
        if (!cancelled) setTrending(list.slice(0, 10))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (trimmed) {
    const terms = suggestions.query === trimmed ? suggestions.terms.slice(0, 8) : []
    const pattern = new RegExp(`(${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig')
    return (
      <div
        data-search-suggest-panel
        onKeyDown={moveInPanel}
        className="bili-suggest absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[min(360px,calc(100vh-80px))] overflow-y-auto rounded-[8px] border border-[var(--line)] bg-[var(--panel)] py-2 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.25)]"
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(trimmed)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)]"
        >
          <Icon name="search" size={14} className="shrink-0 text-[var(--text-3)]" />
          <span className="truncate">搜索 “{trimmed}”</span>
        </button>
        {terms.map((word) => (
          <button
            key={word}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(word)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)]"
          >
            <Icon name="search" size={14} className="shrink-0 text-[var(--text-3)]" />
            <span className="truncate">
              {word.split(pattern).map((part, index) => index % 2 === 1
                ? <span key={index} className="text-[var(--accent)]">{part}</span>
                : part)}
            </span>
          </button>
        ))}
      </div>
    )
  }

  if (history.length === 0 && trending.length === 0) return null

  return (
    /* 按下时挡掉 input 的 blur，动作仍走 onClick，键盘与辅助技术也能触发 */
    <div
      data-search-suggest-panel
      onKeyDown={moveInPanel}
      className="bili-suggest absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[min(360px,calc(100vh-80px))] overflow-y-auto rounded-[8px] border border-[var(--line)] bg-[var(--panel)] py-2 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.25)]"
    >
      {history.length > 0 ? (
        <div className="px-3 pb-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-3)]">搜索历史</span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              className="text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
            >
              清空
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {history.slice(0, 8).map((word) => (
              <button
                key={word}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(word)}
                className="max-w-full truncate rounded-[12px] bg-[var(--ga0)] px-2.5 py-0.5 text-[12.5px] text-[var(--text-2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                {word}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {trending.length > 0 ? (
        <div className={history.length > 0 ? 'mt-1 border-t border-hairline px-3 pt-2' : 'px-3'}>
          <div className="mb-1 text-[12px] text-[var(--text-3)]">大家都在搜</div>
          <div className="grid grid-cols-2 gap-x-3">
            {trending.map((item, i) => (
              <button
                key={item.keyword}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(item.keyword)}
                className="flex min-w-0 items-center gap-2 py-[3px] text-left text-[13px] text-[var(--text-2)] hover:text-[var(--accent)]"
              >
                <span className={`num w-3 shrink-0 text-[12px] ${i < 3 ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'}`}>
                  {i + 1}
                </span>
                {item.icon ? <img src={item.icon} alt="" className="h-3.5 w-auto shrink-0" /> : null}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 顶栏。B 站网页端的搜索框就长在这条 header 里——这是它最好认的一处结构。
 *
 * 左侧 logo + 站名，中间搜索框，右侧状态。搜索框在主区里再放一份是重复的，
 * 所以搜索用它，正文只负责呈现结果。
 */
export function TitleBar() {
  const focusNonce = useAppStore((state) => state.searchFocus)
  const setQuery = useAppStore((state) => state.setHeroQuery)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const navigate = useAppStore((state) => state.navigate)
  const goBack = useAppStore((state) => state.goBack)
  const viewing = useAppStore((state) => state.view.kind === 'watch')
  const auth = useAuthStore((state) => state.auth)
  const user = auth?.user ?? null
  const messaging = useAppStore((state) => state.view.kind === 'messages')
  const unread = useAppStore((state) => state.messageUnread)
  const setUnread = useAppStore((state) => state.setMessageUnread)
  const currentQuery = useAppStore((state) => state.currentQuery)
  const [text, setText] = useState(currentQuery)
  const [focused, setFocused] = useState(false)
  const [account, setAccount] = useState<Anchor | null>(null)
  const [submitMenu, setSubmitMenu] = useState<Anchor | null>(null)
  const [siteMenu, setSiteMenu] = useState<Anchor | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const drag = useWindowDrag()

  // 搜索快捷键和左侧栏都会递增 nonce，这里跟着聚焦。
  useEffect(() => {
    if (focusNonce > 0) {
      inputRef.current?.focus()
      setFocused(true)
    }
  }, [focusNonce])

  // 结果页换了搜索词（点历史、点分区、点作者）时，输入框跟着变
  useEffect(() => {
    setText(currentQuery)
  }, [currentQuery])

  useEffect(() => {
    if (!auth?.logged_in) {
      setUnread(null)
      return
    }
    let cancelled = false
    void ipc.messageUnread()
      .then((next) => {
        if (!cancelled) setUnread(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [auth?.logged_in, auth?.user?.mid, messaging, setUnread])

  const submit = (): void => {
    const word = text.trim()
    if (!word) return
    setFocused(false)
    inputRef.current?.blur()
    setQuery(word)
  }

  const openAccount = (button: HTMLButtonElement): void => {
    const rect = button.getBoundingClientRect()
    const width = 280
    setSubmitMenu(null)
    setSiteMenu(null)
    setAccount({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: rect.bottom + 8,
      anchorTop: rect.top,
      trigger: button,
    })
  }

  const openSubmit = (button: HTMLButtonElement): void => {
    const rect = button.getBoundingClientRect()
    const width = 280
    setAccount(null)
    setSiteMenu(null)
    setSubmitMenu({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: rect.bottom + 8,
      anchorTop: rect.top,
      trigger: button,
    })
  }

  const openSiteMenu = (button: HTMLButtonElement): void => {
    const rect = button.getBoundingClientRect()
    const width = 240
    setAccount(null)
    setSubmitMenu(null)
    setSiteMenu({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: rect.bottom + 8,
      anchorTop: rect.top,
      trigger: button,
    })
  }

  const accountItem = (label: string, icon: IconName, run: () => void) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setAccount(null)
        run()
      }}
      className="t flex h-10 w-full items-center gap-2.5 px-4 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  )

  return (
    <div
      onPointerDown={overlayTitleBar ? drag.onPointerDown : undefined}
      className={`safe-top relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-[var(--panel-alt)] pr-3 md:gap-4 ${overlayTitleBar ? 'pl-[74px] md:pl-[80px]' : 'pl-3'}`}
    >
      <div className="flex w-16 shrink-0 items-center gap-2 sm:w-32 md:gap-4 lg:w-52">
        {viewing ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="返回"
            className="t press flex h-8 shrink-0 items-center gap-1 rounded-[6px] pl-1 pr-2.5 text-[14px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
          >
            <Icon name="chevronLeft" size={18} />
            返回
          </button>
        ) : (
          <div className="pointer-events-none flex shrink-0 items-center gap-2">
            <span className="bili-tv-mark text-[var(--accent)]">
              <Icon name="biliTv" size={19} />
            </span>
            <span className="hidden text-[16px] font-semibold tracking-tight text-[var(--accent)] sm:inline">bilibili</span>
          </div>
        )}

        {/*
         * 站内导航只由左栏承担；顶栏这一颗只收没有站内实现的外部站点。
         * 窄窗没有左栏，同一个菜单顺带补上番剧与直播。
         */}
        {!viewing ? (
          <button
            type="button"
            data-site-menu-trigger
            onClick={(event) => siteMenu ? setSiteMenu(null) : openSiteMenu(event.currentTarget)}
            aria-label="哔哩哔哩网站"
            aria-expanded={siteMenu !== null}
            aria-haspopup="dialog"
            title="哔哩哔哩网站"
            className="t press flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
          >
            <Icon name="external" size={15} />
            <span className="hidden lg:inline">哔哩哔哩网站</span>
          </button>
        ) : null}
      </div>

      <div
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            inputRef.current?.focus({ preventScroll: true })
            setFocused(false)
            return
          }
          if (event.key !== 'ArrowDown' || event.target !== inputRef.current) return
          if (!focused) {
            event.preventDefault()
            setFocused(true)
            return
          }
          const first = event.currentTarget.querySelector<HTMLButtonElement>('[data-search-suggest-panel] button')
          if (!first) return
          event.preventDefault()
          first.focus()
        }}
        className="relative min-w-0 max-w-[520px] flex-1"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="bili-focus-scale flex h-9 w-full min-w-0 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--ga1)] px-3 focus-within:border-[var(--accent)]"
        >
          <Icon name="search" size={15} className="shrink-0 text-[var(--text-3)]" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setFocused(true)
            }}
            onClick={() => setFocused(true)}
            onFocus={() => setFocused(true)}
            placeholder="搜索视频、UP 主"
            aria-label="顶栏搜索"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
          />
          {text ? (
            <button
              type="button"
              aria-label="清空搜索"
              title="清空"
              onClick={() => {
                setText('')
                inputRef.current?.focus()
              }}
              className="t flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)]"
            >
              <Icon name="close" size={12} />
            </button>
          ) : focused ? null : (
            <span className="hidden shrink-0 sm:inline">
              <kbd className="kbd text-[11px] text-[var(--text-3)]">{isMacOS ? '⌘K' : 'Ctrl+K'}</kbd>
            </span>
          )}
          <button
            type="submit"
            className={[
              'bili-press flex h-7 shrink-0 items-center rounded-[6px] px-3 text-[13px]',
              focused || text.trim()
                ? 'bg-[var(--accent-strong)] font-medium text-white hover:bg-[var(--accent-strong-hover)]'
                : 'text-[var(--text-2)] hover:bg-[var(--ga2)] hover:text-[var(--text-1)]',
            ].join(' ')}
          >
            搜索
          </button>
        </form>
        {focused ? (
          <SearchSuggest
            query={text}
            onPick={(word) => {
              setFocused(false)
              inputRef.current?.blur()
              setText(word)
              setQuery(word)
            }}
          />
        ) : null}
      </div>

      <div className="pointer-events-none ml-auto flex shrink-0 items-center gap-2 [&>*]:pointer-events-auto">
        {/*
         * B 站顶栏右侧那一排图标：历史 / 收藏 / 稍后再看。
         * 每一项都进对应的真实页面，不摆点不动的装饰；窄屏收进侧栏与「我的」，
         * 所以这里只在 md 以上出现。
         */}
        <button
          type="button"
          onClick={() => navigate({ kind: 'messages' })}
          title="消息"
          aria-label={unread?.total ? `消息，${unread.total} 条未读` : '消息'}
          className="bili-icon-btn t press relative flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
        >
          <Icon name="message" size={18} />
          {unread && unread.total > 0 ? (
            <span className="num absolute -right-1 -top-0.5 min-w-4 rounded-full bg-[var(--accent)] px-1 text-[10px] leading-4 text-white">
              {unread.total > 99 ? '99+' : unread.total}
            </span>
          ) : null}
        </button>
        <div className="hidden items-center gap-1 md:flex">
          {[
            { kind: 'history' as const, label: '历史', icon: 'clock' as const },
            { kind: 'favs' as const, label: '收藏夹', icon: 'bookmarkStar' as const },
            { kind: 'watchLater' as const, label: '稍后再看', icon: 'watchLater' as const },
          ].map((entry) => (
            <button
              key={entry.kind}
              type="button"
              onClick={() => navigate({ kind: entry.kind })}
              title={entry.label}
              aria-label={entry.label}
              className="bili-icon-btn t press flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
            >
              <Icon name={entry.icon} size={17} />
            </button>
          ))}
        </div>
        {/* 投稿本身在网页端完成，这里用 B 站式菜单把四个入口交给系统浏览器。
            它是次级动作，和搜索一样在中性状态下不抢品牌色。 */}
        <button
          type="button"
          onClick={(event) => submitMenu ? setSubmitMenu(null) : openSubmit(event.currentTarget)}
          aria-expanded={submitMenu !== null}
          aria-haspopup="dialog"
          className="bili-press hidden h-8 shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 text-[13px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--text-1)] sm:flex"
        >
          <Icon name="plus" size={15} />
          投稿
        </button>
        {user ? (
          <button
            type="button"
            onClick={(event) => account ? setAccount(null) : openAccount(event.currentTarget)}
            title={user.uname}
            aria-label="账号菜单"
            aria-haspopup="dialog"
            aria-expanded={account !== null}
            className="bili-press"
          >
            <Avatar src={user.avatar} alt={user.uname} size={26} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="bili-press flex h-7 items-center rounded-[6px] bg-[var(--accent-strong)] px-3 text-[13px] font-medium text-white hover:bg-[var(--accent-strong-hover)]"
          >
            登录
          </button>
        )}
      </div>
      <AnchoredPanel
        anchor={siteMenu}
        onClose={() => setSiteMenu(null)}
        label="哔哩哔哩网站"
        width={240}
      >
        <div
          role="menu"
          data-site-menu
          className="py-1"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            ]
            const at = items.indexOf(document.activeElement as HTMLButtonElement)
            if (at < 0) return
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            items[(at + step + items.length) % items.length]?.focus()
          }}
        >
          {window.innerWidth < 768 ? (
            <>
              <button
                type="button"
                role="menuitem"
                data-site-kind="bangumi"
                onClick={() => {
                  setSiteMenu(null)
                  navigate({ kind: 'bangumi' })
                }}
                className="t flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
              >
                <Icon name="bangumi" size={15} className="text-[var(--text-3)]" />
                番剧
              </button>
              <button
                type="button"
                role="menuitem"
                data-site-kind="live"
                onClick={() => {
                  setSiteMenu(null)
                  navigate({ kind: 'live' })
                }}
                className="t flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
              >
                <Icon name="live" size={15} className="text-[var(--text-3)]" />
                直播
              </button>
              <div className="my-1 h-px bg-hairline" />
            </>
          ) : null}
          {EXTERNAL_SITES.map((site) => (
            <button
              key={site.label}
              type="button"
              role="menuitem"
              data-site-url={site.url}
              onClick={() => {
                setSiteMenu(null)
                void ipc.openExternal(site.url).catch((cause) => toastFailure(`打开${site.label}`, cause))
              }}
              className="t flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
            >
              <Icon name={site.icon} size={15} className="text-[var(--text-3)]" />
              <span className="min-w-0 flex-1 truncate">{site.label}</span>
              <Icon name="external" size={12} className="text-[var(--text-3)]" />
            </button>
          ))}
        </div>
      </AnchoredPanel>
      <AnchoredPanel anchor={submitMenu} onClose={() => setSubmitMenu(null)} label="投稿" width={280}>
        <div className="grid grid-cols-2 gap-1 p-2">
          {(
            [
              ['视频投稿', 'play', 'https://member.bilibili.com/platform/upload/video/frame'],
              ['专栏投稿', 'article', 'https://member.bilibili.com/platform/upload/text/edit'],
              ['动态投稿', 'dynamic', 'https://t.bilibili.com/'],
              ['直播开播', 'live', 'https://link.bilibili.com/p/center/index'],
            ] as const
          ).map(([label, icon, url]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                void ipc.openExternal(url).catch((cause) => toastFailure('打开投稿页', cause))
                setSubmitMenu(null)
              }}
              className="t press flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-[6px] text-[12px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
            >
              <Icon name={icon} size={20} />
              {label}
            </button>
          ))}
        </div>
      </AnchoredPanel>
      <AnchoredPanel anchor={account} onClose={() => setAccount(null)} label="账号菜单" width={280}>
        {user ? (
          <>
            <div className="px-4 pb-3 pt-4">
              <div className="flex items-center gap-3">
                <Avatar src={user.avatar} alt={user.uname} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-[var(--text-1)]">{user.uname}</span>
                    <LevelBadge level={user.level} />
                  </div>
                  <span className="num mt-1 flex items-center gap-1 text-[12px] text-[var(--text-3)]">
                    <Icon name="coin" size={13} className="text-[var(--accent)]" />
                    {user.coins.toFixed(1)} 硬币
                  </span>
                </div>
              </div>
            </div>
            <div className="border-t border-hairline py-1">
              {accountItem('个人空间', 'user', () =>
                navigate({ kind: 'author', name: user.uname, mid: user.mid }),
              )}
              {accountItem('收藏夹', 'bookmarkStar', () => navigate({ kind: 'favs' }))}
              {accountItem('观看历史', 'clock', () => navigate({ kind: 'history' }))}
              {accountItem('投稿管理', 'article', () => {
                void ipc
                  .openExternal('https://member.bilibili.com/platform/upload-manager/article')
                  .catch((cause) => toastFailure('打开投稿管理', cause))
              })}
              {accountItem('创作中心', 'rank', () => {
                void ipc
                  .openExternal('https://member.bilibili.com/platform/home')
                  .catch((cause) => toastFailure('打开创作中心', cause))
              })}
              {accountItem('设置', 'settings', () => navigate({ kind: 'settings' }))}
            </div>
            <div className="border-t border-hairline py-1">
              <button
                type="button"
                onClick={() => {
                  setAccount(null)
                  void useAuthStore.getState().logout()
                }}
                className="t flex h-10 w-full items-center gap-2.5 px-4 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
              >
                <Icon name="logout" size={16} />
                退出登录
              </button>
            </div>
          </>
        ) : null}
      </AnchoredPanel>
    </div>
  )
}
