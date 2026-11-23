import type { Track } from '../../shared/lib/contract'
import { TrackByline } from './TrackByline'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { PageSpine } from './PageSpine'

export function WideCard({
  track,
  note,
  noteAsTag = false,
  lead = false,
  onOpen,
}: {
  track: Track
  note?: string | null
  lead?: boolean
  noteAsTag?: boolean
  onOpen: () => void
}) {
  return (
    <div className={`bili-card flex min-w-0 items-start ${lead ? 'flex-col gap-3' : 'gap-3 md:gap-4'}`} data-wide-card={track.key}>
      <button
        type="button"
        onClick={onOpen}
        data-focus-id={`wide:${track.key}`}
        aria-label={`观看 ${track.title}`}
        className={`group relative aspect-video shrink-0 overflow-hidden rounded-[8px] ${lead ? 'w-full' : 'w-[36%] max-w-[190px]'}`}
      >
        <Cover cover={track.cover} title={track.title} width={lead ? 640 : 190} className="bili-card-cover h-full w-full" />
        <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/65 px-1 text-[11px] leading-[16px] text-white">
          {formatDuration(track.duration_ms)}
        </span>
        <PageSpine pages={track.pages} trackKey={track.key} />
      </button>
      <div className="min-w-0 max-w-full flex-1 py-0.5">
        <button type="button" onClick={onOpen} title={track.title} className="block w-full text-left">
          <span className={`line-clamp-2 break-words text-[var(--text-1)] hover:text-[var(--accent)] ${lead ? 'text-xl leading-snug font-semibold md:text-2xl' : 'text-work-name'}`}>
            {track.title}
          </span>
        </button>
        {note && noteAsTag ? (
          <span className="mt-1 inline-flex w-fit items-center rounded-[3px] border border-[#ffb07c] px-1.5 text-[11px] leading-[17px] text-[#ff7a45]">
            {note}
          </span>
        ) : null}
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
          <TrackByline track={track} focusId={`wide-author:${track.key}`} />
        </div>
        <span className="num mt-1 flex items-center gap-3 text-page-meta text-[var(--text-3)]">
          {track.views ? (
            <span className="flex items-center gap-0.5">
              <Icon name="play" size={11} />
              {formatCount(track.views)}
            </span>
          ) : null}
          {(track.danmaku ?? 0) > 0 ? (
            <span className="flex items-center gap-0.5">
              <Icon name="danmaku" size={11} />
              {formatCount(track.danmaku!)}
            </span>
          ) : null}
        </span>
        {note && !noteAsTag ? (
          <span className="mt-1.5 flex items-baseline gap-1 text-reading-body text-[var(--text-2)]">
            <span aria-hidden className="shrink-0 text-[13px] leading-none">
              ❝
            </span>
            <span className="min-w-0 break-words">{note}</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}
