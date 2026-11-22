import type { HistoryEntry } from '../../shared/lib/ipc'
import { formatTime } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'

export type Resume = {
  entry: HistoryEntry
  /** 有本地观看记录才算「看」，否则按「听」处理。 */
  watching: boolean
  page: number | null
}

/**
 * 从历史里挑出第一条还能接着放的记录。
 *
 * 有效断点沿用播放器的规矩：至少 5 秒，且没有落在片尾 1 秒内；
 * 连总时长都没有的记录没法证明位置有效，也不占续播位。
 */
export function resumeFrom(list: HistoryEntry[]): Resume | null {
  for (const entry of list) {
    const duration = entry.track.duration_ms ?? 0
    if (duration <= 0) continue
    if (entry.position_ms < 5_000 || entry.position_ms >= duration - 1_000) continue
    const watch = readWatchProgress(entry.track.key)
    const page = watch && watch.page > 1 ? watch.page : null
    return { entry, watching: watch !== null, page }
  }
  return null
}

/** 观看页把分 P 进度写在本地；有这份记录才敢说这是「看过的视频」。 */
function readWatchProgress(key: string): { page: number } | null {
  try {
    const stored = Number(localStorage.getItem(`oh-bilibili:watch-page:${key}`))
    if (Number.isInteger(stored) && stored > 0) return { page: stored }
    const prefix = `oh-bilibili:watch-pos:${key}:`
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i)
      if (!name?.startsWith(prefix)) continue
      const page = Number(name.slice(prefix.length))
      if (Number.isInteger(page) && page > 0) return { page }
    }
  } catch {
    // 隐私模式读不到，按「听」处理
  }
  return null
}

export function ResumeCard({
  resume,
  compact = false,
  onOpen,
}: {
  resume: Resume
  compact?: boolean
  onOpen: (resume: Resume) => void
}) {
  const track = resume.entry.track
  const duration = track.duration_ms ?? 0
  const ratio = duration > 0 ? Math.min(1, resume.entry.position_ms / duration) : 0
  const action = resume.watching ? '继续观看' : '继续听'
  const watchedFor = `${resume.watching ? '已看' : '已听'} ${formatTime(resume.entry.position_ms)}`

  if (compact) {
    return (
      <button
        type="button"
        data-home-resume="compact"
        onClick={() => onOpen(resume)}
        className="group flex w-full items-center gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-2 text-left"
      >
        <span className="relative w-[128px] shrink-0 overflow-hidden rounded-[5px]" style={{ aspectRatio: '16 / 9' }}>
          <Cover cover={track.cover} title={track.title} width={256} className="h-full w-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-[13.5px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
            {track.title}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-3)]">
            <span className="truncate">{track.artist}</span>
            {resume.page ? <span className="num shrink-0">P{resume.page}</span> : null}
          </span>
          <span aria-hidden className="mt-2 block h-[3px] overflow-hidden rounded-full bg-[var(--line)]">
            <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className="mt-1 flex items-center justify-between text-[11px]">
            <span className="num text-[var(--text-3)]">{watchedFor}</span>
            <span className="text-[var(--accent)]">{action}</span>
          </span>
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-home-resume="wide"
      onClick={() => onOpen(resume)}
      className="group block w-full overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] text-left"
    >
      <span className="relative block w-full overflow-hidden" style={{ aspectRatio: '16 / 7' }}>
        <Cover cover={track.cover} title={track.title} width={720} className="h-full w-full" />
        {resume.page ? (
          <span className="num absolute left-3 top-3 rounded-[3px] bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
            P{resume.page}
          </span>
        ) : null}
      </span>
      <span className="block px-3.5 py-3">
        <span className="line-clamp-2 text-[15px] leading-[21px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
          {track.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-3)]">
          <span className="truncate">{track.artist}</span>
        </span>
        <span aria-hidden className="mt-2.5 block h-[3px] overflow-hidden rounded-full bg-[var(--line)]">
          <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${ratio * 100}%` }} />
        </span>
        <span className="mt-1.5 flex items-center justify-between text-[12px]">
          <span className="num text-[var(--text-3)]">{watchedFor}</span>
          <span className="flex items-center gap-0.5 text-[var(--accent)]">
            {action}
            <Icon name="chevronRight" size={12} />
          </span>
        </span>
      </span>
    </button>
  )
}
