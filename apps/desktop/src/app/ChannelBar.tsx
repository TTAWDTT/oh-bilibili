import type { View } from './appStore'
import { useAppStore } from './appStore'

type Channel = { view: View; label: string }

/**
 * 频道导航。照 B 站网页端做成纯文字，不带图标。
 *
 * 每个频道顶一个彩色方块是手机 App 的做法；桌面网页端一条文字读起来更快，
 * 也不会让七种颜色抢掉内容本身的注意力。
 */
const CHANNELS: readonly Channel[] = [
  { view: { kind: 'home' }, label: '发现' },
  { view: { kind: 'search' }, label: '搜索' },
  { view: { kind: 'history' }, label: '历史' },
  { view: { kind: 'favs' }, label: '收藏夹' },
  { view: { kind: 'watchLater' }, label: '稍后再看' },
  { view: { kind: 'following' }, label: '关注' },
  { view: { kind: 'library' }, label: '曲库' },
  { view: { kind: 'settings' }, label: '设置' },
]

export function ChannelBar() {
  const view = useAppStore((state) => state.view)
  const navigate = useAppStore((state) => state.navigate)

  return (
    <nav
      aria-label="频道"
      className="relative flex h-11 shrink-0 items-stretch gap-4 border-b border-[var(--line)] bg-[var(--panel)] pl-[80px] pr-4"
    >
      {CHANNELS.map((channel) => {
        const active = view.kind === channel.view.kind
        return (
          <button
            key={channel.label}
            type="button"
            onClick={() => navigate(channel.view)}
            aria-current={active ? 'page' : undefined}
            className={[
              't relative flex items-center px-0.5 text-[15px]',
              active
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]',
            ].join(' ')}
          >
            {channel.label}
            {active ? (
              <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />
            ) : null}
          </button>
        )
      })}
      <div className="ml-auto flex items-center gap-2 pr-1">
      </div>
      <span className="bili-topline absolute inset-x-0 bottom-0 h-[2px] opacity-70" />
    </nav>
  )
}

