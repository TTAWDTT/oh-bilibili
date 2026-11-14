import { useEffect, useRef, useState } from 'react'
import { useAppStore } from './appStore'
import { useAuthStore } from '../features/auth/authStore'
import { Avatar } from '../shared/ui/Avatar'
import { useWindowDrag } from '../shared/lib/useWindowDrag'
import { Icon } from '../shared/ui/Icon'

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
  const currentQuery = useAppStore((state) => state.currentQuery)
  const [text, setText] = useState(currentQuery)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const drag = useWindowDrag()

  // ⌘K / 左侧栏点击都会递增 nonce，这里跟着聚焦
  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus()
  }, [focusNonce])

  // 结果页换了搜索词（点历史、点分区、点作者）时，输入框跟着变
  useEffect(() => {
    setText(currentQuery)
  }, [currentQuery])

  const submit = (): void => {
    setQuery(text.trim())
  }

  return (
    <div
      {...drag}
      className="safe-top relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-[var(--panel-alt)] pl-[74px] pr-3 md:gap-4 md:pl-[80px]"
    >
      {/* 观看页把 logo 换成返回：B 站网页版的返回在页面顶栏，不压在画面上。
          其余页面保持 logo —— 它不参与命中，按下时目标才是带 data-tauri-drag-region
          的顶栏本身，窗口才能被拖动。 */}
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
          {/* 官方 wordmark 是粉色 #FF6699；蓝色是 B 站的链接与按钮色，不是标志色。 */}
          <span className="bili-tv-mark text-[var(--bili-pink)]">
            <Icon name="biliTv" size={19} />
          </span>
          <span className="hidden text-[16px] font-semibold tracking-tight text-[var(--bili-pink)] sm:inline">bilibili</span>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="bili-focus-scale flex h-9 min-w-0 max-w-[520px] flex-1 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--ga1)] px-3"
      >
        <Icon name="search" size={15} className="shrink-0 text-[var(--text-3)]" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
          <span className="kbd shrink-0 text-[11px] text-[var(--text-3)]">⌘K</span>
        )}
        <button
          type="submit"
          className="bili-press flex h-7 shrink-0 items-center rounded-[6px] bg-[var(--accent)] px-3 text-[13px] font-medium text-white"
        >
          搜索
        </button>
      </form>

      <div className="pointer-events-none ml-auto flex shrink-0 items-center gap-2 [&>*]:pointer-events-auto">
        {/*
         * B 站顶栏右侧那一排图标：历史 / 收藏 / 稍后再看。
         * 每一项都进对应的真实页面，不摆点不动的装饰；窄屏收进侧栏与「我的」，
         * 所以这里只在 md 以上出现。
         */}
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
              className="t press flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
            >
              <Icon name={entry.icon} size={17} />
            </button>
          ))}
        </div>
        {auth?.user ? (
          <button
            type="button"
            onClick={() => navigate({ kind: 'settings' })}
            title={auth.user.uname}
            aria-label="账号设置"
            className="bili-press"
          >
            <Avatar src={auth.user.avatar} alt={auth.user.uname} size={26} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="bili-press flex h-7 items-center rounded-[6px] bg-[var(--accent)] px-3 text-[13px] font-medium text-white"
          >
            登录
          </button>
        )}
      </div>
    </div>
  )
}
