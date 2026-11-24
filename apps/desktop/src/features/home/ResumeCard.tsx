import type { HistoryEntry } from '../../shared/lib/ipc'
import { formatTime } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { knownPageCount } from '../tracks/pageSpineLabel'

export type Resume = {
  entry: HistoryEntry
  /** 有本地观看记录才算「看」，否则按「听」处理。 */
  watching: boolean
  page: number | null
  partTitle?: string
  /** 当前分 P 的位置与时长；听歌条目直接用历史里的值。 */
  position: number
  duration: number
}

/**
 * 从历史里挑出第一条还能接着放的记录。
 *
 * 有效断点沿用播放器的规矩：至少 5 秒，且没有落在片尾 1 秒内；
 * 连总时长都没有的记录没法证明位置有效，也不占续播位。
 */
export function resumeFrom(list: HistoryEntry[]): Resume | null {
  for (const entry of list) {
    const watch = readWatchProgress(entry.track.key)
    const position = watch ? watch.position : entry.position_ms ?? 0
    // 历史里的 duration 是整条投稿的总长；观看记录里有这一 P 自己的时长。
    const duration = watch ? watch.duration : entry.track.duration_ms ?? 0
    if (!(position >= 5_000)) continue
    if (duration <= 0) continue
    if (position >= duration - 1_000) continue
    const page = watch && (watch.page > 1 || (knownPageCount(entry.track.key, entry.track.pages) ?? 0) > 1) ? watch.page : null
    return { entry, watching: watch !== null, page, position, duration }
  }
  return null
}

/** 观看页把分 P 进度写在本地；有这份记录才敢说这是「看过的视频」。 */
function readWatchProgress(key: string): { page: number; position: number; duration: number } | null {
  const read = (page: number) => {
    const position = Number(localStorage.getItem(`oh-bilibili:watch-pos:${key}:${page}`))
    const duration = Number(localStorage.getItem(`oh-bilibili:watch-len:${key}:${page}`))
    return {
      page,
      position: Number.isFinite(position) ? position : 0,
      duration: Number.isFinite(duration) ? duration : 0,
    }
  }
  try {
    const stored = Number(localStorage.getItem(`oh-bilibili:watch-page:${key}`))
    if (Number.isInteger(stored) && stored > 0) return read(stored)
    const prefix = `oh-bilibili:watch-pos:${key}:`
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i)
      if (!name?.startsWith(prefix)) continue
      const page = Number(name.slice(prefix.length))
      if (Number.isInteger(page) && page > 0) return read(page)
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
  const ratio = resume.duration > 0 ? Math.min(1, resume.position / resume.duration) : 0
  const action = resume.watching ? '继续观看' : '继续听'
  const watchedFor = `${resume.watching ? '已看' : '已听'} ${formatTime(resume.position)}`

  return (
    <button
      type="button"
      data-home-resume={compact ? 'compact' : 'wide'}
      data-key={track.key}
      data-focus-id={`resume:${track.key}`}
      onClick={() => onOpen(resume)}
      className={`group w-full min-w-0 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--panel)] text-left ${compact ? 'flex items-center gap-3 p-2' : 'block'}`}
    >
      <span className={`relative block overflow-hidden bg-[var(--ga1)] ${compact ? 'aspect-video w-[26%] max-w-[136px] shrink-0 rounded-[5px]' : 'aspect-video w-full'}`}>
        <Cover cover={track.cover} title={track.title} width={compact ? 160 : 560} className="h-full w-full" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 block h-[3px] bg-black/45">
          <span className="block h-full bg-[var(--accent)]" style={{ width: `${ratio * 100}%` }} />
        </span>
      </span>
      <span className={compact ? 'min-w-0 flex-1 py-0.5 pr-1' : 'block px-3.5 py-3'}>
        <span className={`line-clamp-2 font-semibold text-[var(--text-1)] group-hover:text-[var(--accent-strong)] ${compact ? 'text-[14px] leading-[19px]' : 'text-[17px] leading-[1.4]'}`}>
          {track.title}
        </span>
        {track.artist && (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-2)]">
            <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[14px]">UP</span>
            <span className="truncate">{track.artist}</span>
          </span>
        )}
        {resume.page && (
          <span className="mt-1 flex min-w-0 items-baseline gap-1.5 text-[12px] text-[var(--text-2)]">
            <span className="num shrink-0 font-medium">P{resume.page}</span>
            {resume.partTitle && <span className="truncate">{resume.partTitle}</span>}
          </span>
        )}
        <span className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${compact ? 'mt-1' : 'mt-2.5 border-t border-[var(--line)] pt-2.5'}`}>
          <span className="num text-[12px] text-[var(--text-2)]">{watchedFor} / {formatTime(resume.duration)}</span>
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-strong)]">
            <Icon name={resume.watching ? 'play' : 'music'} size={13} />{action}
          </span>
        </span>
      </span>
    </button>
  )
}
