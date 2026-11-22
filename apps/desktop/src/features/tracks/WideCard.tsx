import type { Track } from '../../shared/lib/contract'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'

/**
 * B 站「热门 / 入站必刷」这两页用的横排大卡：封面在左，标题与计数在右。
 * 和发现页的封面网格不是一套密度，所以单列出来，不塞进 ContentGrid。
 * `note` 只有入站必刷给：B 站那张卡底部有一条橙色推荐语。
 */
export function WideCard({
  track,
  note,
  noteAsTag = false,
  onOpen,
}: {
  track: Track
  note?: string | null
  /** 热门页的标签是「百万播放」这种短词，B 站画成一个橙色描边小胶囊；入站必刷是整句话。 */
  noteAsTag?: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-focus-id={`wide:${track.key}`}
      className="bili-card group flex items-start gap-4 text-left"
      title={track.title}
    >
      <span className="relative aspect-video w-[190px] shrink-0 overflow-hidden rounded-[8px]">
        <Cover cover={track.cover} title={track.title} width={190} className="bili-card-cover h-full w-full" />
        <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/65 px-1 text-[11px] leading-[16px] text-white">
          {formatDuration(track.duration_ms)}
        </span>
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="line-clamp-2 text-[15px] font-medium leading-[22px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
          {track.title}
        </span>
        {/* 热门页的标签在标题正下方、UP 之上；入站必刷的推荐语在整张卡最底部。 */}
        {note && noteAsTag ? (
          <span className="mt-1 inline-flex w-fit items-center rounded-[3px] border border-[#ffb07c] px-1.5 text-[11px] leading-[17px] text-[#ff7a45]">
            {note}
          </span>
        ) : null}
        <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
          <span className="shrink-0 rounded-[3px] border border-[var(--line)] px-1 text-[10px] leading-[14px]">UP</span>
          <span className="truncate">{track.artist}</span>
        </span>
        <span className="num mt-1 flex items-center gap-3 text-[12px] text-[var(--text-3)]">
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
          <span className="mt-1.5 flex items-center gap-1 text-[12px] text-[#ff7a45]">
            {/* B 站入站必刷 / 每周必看的推荐语前面是一对橙色引号，不是火焰图标。 */}
            <span aria-hidden className="shrink-0 text-[13px] leading-none">
              ❝
            </span>
            <span className="truncate">{note}</span>
          </span>
        ) : null}
      </span>
    </button>
  )
}
