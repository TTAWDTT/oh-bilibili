import { useEffect, useRef, useState } from 'react'
import { useAppStore } from './appStore'
import { useAuthStore } from '../features/auth/authStore'
import { Avatar } from '../shared/ui/Avatar'
import * as ipc from '../shared/lib/ipc'
import { toastFailure } from './notice'
import { useWindowDrag } from '../shared/lib/useWindowDrag'
import { Icon } from '../shared/ui/Icon'
import { useSearchHistory } from '../shared/lib/searchHistory'

/**
 * 顶栏搜索框下面的建议面板。
 *
 * B 站这块是两栏：左边搜索历史，右边热搜榜。热搜走 search/square，
 * 取不到就只显示历史，面板不会因为一个可选接口挂掉。
 */
function SearchSuggest({ onPick }: { onPick: (word: string) => void }) {
  const history = useSearchHistory((state) => state.items)
  const clear = useSearchHistory((state) => state.clear)
  const [trending, setTrending] = useState<string[]>([])

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

  if (history.length === 0 && trending.length === 0) return null

  return (
    /* 用 onMouseDown 而不是 onClick：先于 input 的 blur 触发，点得中 */
    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] py-2 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.25)]">
      {history.length > 0 ? (
        <div className="px-3 pb-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-3)]">搜索历史</span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                clear()
              }}
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
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(word)
                }}
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
            {trending.map((word, i) => (
              <button
                key={word}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(word)
                }}
                className="flex min-w-0 items-center gap-2 py-[3px] text-left text-[13px] text-[var(--text-2)] hover:text-[var(--accent)]"
              >
                <span className={`num w-3 shrink-0 text-[12px] ${i < 3 ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'}`}>
                  {i + 1}
                </span>
                <span className="truncate">{word}</span>
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
          <span className="bili-tv-mark text-[var(--accent)]">
            <Icon name="biliTv" size={19} />
          </span>
          <span className="hidden text-[16px] font-semibold tracking-tight text-[var(--accent)] sm:inline">bilibili</span>
        </div>
      )}

      {/*
       * B 站网页端 header 里 logo 右边那排频道：首页 / 番剧 / 直播 / 游戏中心 / 会员购。
       * 前三个进站内页；游戏中心与会员购没有站内实现，如实交给系统浏览器，
       * 不做成点了没反应的假入口。窄窗口收起来，避免和搜索框抢位置。
       */}
      {!viewing ? (
        <nav aria-label="频道" className="pointer-events-auto hidden shrink-0 items-center gap-0.5 xl:flex">
          {[
            { label: '首页', run: () => navigate({ kind: 'home' }) },
            { label: '番剧', run: () => navigate({ kind: 'bangumi' }) },
            { label: '直播', run: () => navigate({ kind: 'live' }) },
          ].map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={entry.run}
              /* 网页端这排是纯文字，不带图标；带上图标就成了 App 的频道栏 */
              className="t press flex h-8 shrink-0 items-center rounded-[6px] px-2.5 text-[13.5px] text-[var(--text-2)] hover:text-[var(--accent)]"
            >
              {entry.label}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="relative min-w-0 max-w-[520px] flex-1">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="bili-focus-scale flex h-9 w-full min-w-0 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--ga1)] px-3"
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
        {/*
         * B 站搜索框点进去会落下一块建议面板：历史 + 热搜。
         * 只在输入为空时出现——已经在打字的人要的是自己的词，不是别人的榜。
         */}
        {focused && text.trim().length === 0 ? (
          <SearchSuggest
            onPick={(word) => {
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
        {/* B 站顶栏最右边那颗粉色投稿：站里唯一一个实心品牌色按钮。
            投稿本身在网页端完成，这里如实把官方上传页交给系统浏览器。 */}
        <button
          type="button"
          onClick={() =>
            void ipc
              .openExternal('https://member.bilibili.com/platform/upload/video/frame')
              .catch((cause) => toastFailure('打开投稿页', cause))
          }
          className="bili-press hidden h-8 shrink-0 items-center rounded-[4px] bg-[var(--accent)] px-3.5 text-[13px] text-white hover:opacity-90 sm:flex"
        >
          投稿
        </button>
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
