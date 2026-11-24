import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'

export function TrackByline({ track, focusId, wrap = false }: { track: Track; focusId: string; wrap?: boolean }) {
  const navigate = useAppStore((state) => state.navigate)
  const mid = track.up_mid
  const name = (
    <>
      <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[14px]">UP</span>
      <span className={wrap ? 'line-clamp-2 break-words text-left' : 'truncate'}>{track.artist}</span>
    </>
  )
  const style = 'inline-flex max-w-full min-w-0 items-center gap-1.5 align-top'
  if (!mid) return <span className={style} title={track.artist}>{name}</span>
  return (
    <button
      type="button"
      className={`${style} hover:text-[var(--accent-strong-hover)]`}
      aria-label={`UP ${track.artist}`}
      title={`看 ${track.artist} 的更多视频`}
      data-focus-id={focusId}
      onClick={() => navigate({ kind: 'author', name: track.artist, mid }, undefined, focusId)}
    >{name}</button>
  )
}
