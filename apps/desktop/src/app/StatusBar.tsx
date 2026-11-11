import { useAppStore } from './appStore'
import { useHasSession, useIsListening, usePlayerStore } from '../features/player/playerStore'
import { Icon } from '../shared/ui/Icon'
import { PlayheadText } from '../shared/ui/PlayheadText'

/**
 * 状态条。编辑器式外壳的最后一段：22px 高、12px 字，只放事实，不放操作。
 * 播放器的短暂状态（码率、音源、队列长度）集中在这里，主界面就不用到处贴徽标。
 *
 * 视频页不显示：这里全是音乐会话的量（队列「首」数、播放快捷键），
 * 摆在视频下面就是误导。
 */
export function StatusBar() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const queue = usePlayerStore((state) => state.queue)
  const view = useAppStore((state) => state.view)
  const listening = useIsListening()
  const hasSession = useHasSession()

  const quality = snapshot?.quality_kbps ?? null
  const queued = queue?.items.length ?? 0
  if (view.kind === 'watch') return null
  // 队列与码率只在「正在听」时才是事实。刷视频时挂着「34 首在队列」
  // 和播放快捷键，说的是另一件事，读起来就是错的。
  const music = listening && hasSession

  return (
    <footer className="hidden md:flex flex h-[22px] shrink-0 items-center justify-between border-t border-hairline bg-[var(--panel-alt)] px-2 text-[12px] text-[var(--text-3)]">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Icon name="biliTv" size={12} />
          本机直连 B 站
        </span>
        {music ? (
          <>
            <PlayheadText className="num" durationMs={snapshot?.duration_ms ?? 0} />
            <span className="num">{quality ? `${quality}K` : '—'}</span>
            <span className="num">{queued} 首在队列</span>
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {music ? (
          <>
            <span>空格 播放/暂停</span>
            <span>← → 快退快进</span>
          </>
        ) : null}
        <span>⌘K 搜索</span>
      </div>
    </footer>
  )
}
