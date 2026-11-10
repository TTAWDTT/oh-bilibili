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
  const navigate = useAppStore((state) => state.navigate)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const auth = useAuthStore((state) => state.auth)
  const currentQuery = useAppStore((state) => state.currentQuery)
  const [text, setText] = useState(currentQuery)
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
        <span className="bili-tv-mark text-[var(--accent)]">
          <Icon name="biliTv" size={19} />
        </span>
        <span className="hidden text-[16px] font-semibold tracking-tight text-[var(--accent)] sm:inline">bilibili</span>
        <span className="hidden rounded-[3px] border border-hairline px-1.5 text-[12px] text-[var(--text-3)] md:inline">
          music
        </span>
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
          placeholder="搜索视频、UP 主"
          aria-label="顶栏搜索"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
        />
        <button
          type="submit"
          className="bili-press flex h-7 shrink-0 items-center rounded-[6px] bg-[var(--accent)] px-3 text-[13px] font-medium text-white"
        >
          搜索
        </button>
      </form>

      <div className="pointer-events-none ml-auto flex shrink-0 items-center gap-3 [&>*]:pointer-events-auto">
        <button
          type="button"
          onClick={() => navigate({ kind: 'downloads' })}
          title="下载"
          className="bili-icon-hover text-[var(--text-2)] hover:text-[var(--accent)]"
        >
          <Icon name="download" size={17} />
        </button>
        <button
          type="button"
          onClick={() => navigate({ kind: 'history' })}
          title="历史"
          className="bili-icon-hover text-[var(--text-2)] hover:text-[var(--accent)]"
        >
          <Icon name="clock" size={17} />
        </button>
        <button
          type="button"
          onClick={() => navigate({ kind: 'favs' })}
          title="收藏夹"
          className="bili-icon-hover text-[var(--text-2)] hover:text-[var(--accent)]"
        >
          <Icon name="bookmarkStar" size={17} />
        </button>

        {auth?.user ? (
          <button type="button" onClick={() => setAuthOpen(true)} title={auth.user.uname} className="bili-press">
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
