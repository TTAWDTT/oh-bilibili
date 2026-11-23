import { TrackByline } from '../tracks/TrackByline'
import type { PreciousItemView } from '../../shared/lib/contract'
import { useAppStore } from '../../app/appStore'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'

/**
 * 入站必刷的一件展品。
 *
 * 宽展位（hero）把封面与入选理由并排，紧凑展位图下直接放展签。
 * 标题与理由按服务端原文展示，不改成自己的说法。
 */
export function PreciousExhibit({
  item,
  hero,
  expanded,
  onToggleNote,
}: {
  item: PreciousItemView
  hero: boolean
  expanded: boolean
  onToggleNote: () => void
}) {
  const navigate = useAppStore((state) => state.navigate)
  const { track, note } = item
  const open = (): void => navigate({ kind: 'watch', track }, undefined, `precious:${track.key}`)
  const cover = (
    <button
      type="button"
      onClick={open}
      aria-label={`观看 ${track.title}`}
      data-focus-id={`precious:${track.key}`}
      className="group relative block aspect-video w-full shrink-0 overflow-hidden rounded-[8px] bg-[var(--ga1)]"
    >
      <Cover cover={track.cover} title={track.title} width={hero ? 520 : 260} className="h-full w-full" />
      <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/65 px-1 text-[11px] leading-[16px] text-white">
        {formatDuration(track.duration_ms)}
      </span>
    </button>
  )

  const title = (
    <button
      type="button"
      onClick={open}
      title={track.title}
      className={[
        'block w-full text-left font-medium text-[var(--text-1)] hover:text-[var(--accent)]',
        hero ? 'line-clamp-2 text-[20px] leading-[28px]' : 'line-clamp-2 text-[14px] leading-[20px]',
      ].join(' ')}
    >
      {track.title}
    </button>
  )

  const byline = (
    <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-3)]">
      <TrackByline track={track} focusId={`precious-author:${track.key}`} />
      {track.views ? (
        <span className="num flex shrink-0 items-center gap-0.5">
          <Icon name="play" size={11} />
          {formatCount(track.views)}
        </span>
      ) : null}
    </div>
  )

  const reason = note ? (
    <div className={hero ? 'mt-3' : 'mt-1.5'}>
      <p
        className={[
          'flex items-start gap-1 text-[#ff7a45]',
          hero ? 'text-[14px] leading-[22px]' : 'text-[12px] leading-[18px]',
          expanded ? '' : 'line-clamp-2',
        ].join(' ')}
      >
        <span aria-hidden className="shrink-0 text-[13px] leading-none">
          ❝
        </span>
        <span className="min-w-0 break-words">{note}</span>
      </p>
      {note.length > (hero ? 46 : 34) ? (
        <button
          type="button"
          onClick={onToggleNote}
          aria-expanded={expanded}
          className="t mt-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          {expanded ? '收起理由' : '展开理由'}
        </button>
      ) : null}
    </div>
  ) : null

  if (hero) {
    return (
      <article className="grid min-w-0 items-start gap-4 rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-4 md:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] md:gap-5">
        {cover}
        <div className="min-w-0">
          {title}
          {byline}
          {reason}
        </div>
      </article>
    )
  }

  return (
    <article className="min-w-0">
      {cover}
      <div className="mt-2 min-w-0">
        {title}
        {byline}
        {reason}
      </div>
    </article>
  )
}
