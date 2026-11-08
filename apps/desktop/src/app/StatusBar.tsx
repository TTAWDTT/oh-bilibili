import { usePlayerStore } from '../features/player/playerStore'
import { formatTime } from '../shared/lib/format'

/**
 * 状态条。编辑器式外壳的最后一段：22px，11px 字，只放事实，不放操作。
 * 播放器的短暂状态（码率、音源、队列长度）集中在这里，主界面就不用到处贴徽标。
 */
export function StatusBar() {
  const snapshot = usePlayerStore((state) => state.snapshot)
  const queue = usePlayerStore((state) => state.queue)

  const quality = snapshot?.quality_kbps ?? null
  const queued = queue?.items.length ?? 0

  return (
    <footer className="flex h-[22px] shrink-0 items-center justify-between border-t border-hairline bg-[var(--panel-alt)] px-2 text-[11px] text-[var(--text-3)]">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          本机直连
        </span>
        <span className="num">
          {formatTime(snapshot?.position_ms ?? 0)} / {formatTime(snapshot?.duration_ms ?? 0)}
        </span>
        <span className="num">{quality ? `${quality}K` : '—'}</span>
        <span className="num">{queued} 首在队列</span>
      </div>
      <div className="flex items-center gap-3">
        <span>空格 播放/暂停</span>
        <span>← → 快退快进</span>
        <span>⌘K 搜索</span>
      </div>
    </footer>
  )
}
