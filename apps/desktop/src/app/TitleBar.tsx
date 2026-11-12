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
      {/* 装饰性的 logo 块不参与命中：让它穿透，按下时目标才是带
          data-tauri-drag-region 的顶栏本身，窗口才能被拖动。
          Tauri 的判定只看事件目标自己有没有这个属性，所以子元素必须穿透。 */}
      <div className="pointer-events-none flex shrink-0 items-center gap-2">
        {/* 官方 wordmark 是粉色 #FF6699；蓝色是 B 站的链接与按钮色，不是标志色。 */}
        <span className="bili-tv-mark text-[var(--bili-pink)]">
          <Icon name="biliTv" size={19} />
        </span>
        <span className="hidden text-[16px] font-semibold tracking-tight text-[var(--bili-pink)] sm:inline">bilibili</span>
      </div>

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
        {focused || text ? null : <span className="kbd shrink-0 text-[11px] text-[var(--text-3)]">⌘K</span>}
        <button
          type="submit"
          className="bili-press flex h-7 shrink-0 items-center rounded-[6px] bg-[var(--accent)] px-3 text-[13px] font-medium text-white"
        >
          搜索
        </button>
      </form>

      <div className="pointer-events-none ml-auto flex shrink-0 items-center gap-3 [&>*]:pointer-events-auto">
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
