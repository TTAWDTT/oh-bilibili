import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { usePlayerStore } from '../player/playerStore'

/** 从标题里认出分辨率与音质角标。B 站自己在封面右上角标这些。 */
function coverFlags(title: string): string[] {
  const flags: string[] = []
  if (/4\s*K|2160/i.test(title)) flags.push('4K')
  if (/hi-?res|hires/i.test(title)) flags.push('Hi-Res')
  if (/无损/.test(title)) flags.push('无损')
  if (/杜比|\(dolby\)/i.test(title)) flags.push('杜比')
  return flags.slice(0, 2)
}

/** 分区胶囊：从标题推断，没有标签的视频不显示。 */
function tagsOf(title: string): string[] {
  const tags: string[] = []
  if (/翻唱|cover/i.test(title)) tags.push('翻唱')
  if (/纯音乐|钢琴|吉他|演奏/.test(title)) tags.push('纯音乐')
  if (/现场|live|演唱会/i.test(title)) tags.push('现场')
  if (/mv|官方/i.test(title)) tags.push('MV')
  if (tags.length === 0) tags.push('音乐')
  return tags.slice(0, 2)
}

type TrackGridProps = {
  tracks: Track[]
  activeKey: string | null
  playing: boolean
}

/**
 * B 站风格的封面卡片网格。
 *
 * 视频网站的身份是「封面主导」，不是「行主导」。这里照着 B 站网页端的比例做：
 * 16:10 封面、圆角 6px、时长压右下角、标题两行、UP 主一行灰字，hover 时标题变粉。
 */
export function TrackGrid({ tracks, activeKey, playing }: TrackGridProps) {
  const playContext = usePlayerStore((state) => state.playContext)
  const setMv = useAppStore((state) => state.setMv)

  return (
    <div className="grid gap-x-4 gap-y-6 pb-6 [grid-template-columns:repeat(auto-fill,minmax(196px,1fr))]">
      {tracks.map((track, index) => {
        const active = track.key === activeKey
        return (
          <article key={track.key} className="group">
            <button
              type="button"
              onClick={() => void playContext(tracks.map((t) => t.key), index)}
              aria-label={`播放 ${track.title}`}
              className="relative block w-full overflow-hidden rounded-[6px] border border-[var(--line)]"
              style={{ aspectRatio: '16 / 10' }}
            >
              <Cover
                cover={track.cover}
                title={track.title}
                className="h-full w-full"
                glyphClassName="text-[40px] font-semibold text-white/85"
              />
              {coverFlags(track.title).length > 0 ? (
                <span className="absolute right-1 top-1 flex gap-1">
                  {coverFlags(track.title).map((f) => (
                    <span
                      key={f}
                      className="rounded-[2px] bg-[var(--accent)] px-1 text-[9.5px] leading-[14px] text-white"
                    >
                      {f}
                    </span>
                  ))}
                </span>
              ) : null}
              {/* 时长压右下角，和 B 站一致 */}
              <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/65 px-1 text-[10.5px] leading-[15px] text-white">
                {formatDuration(track.duration_ms)}
              </span>
              {/* hover 才出现的播放态遮罩 */}
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity duration-150 group-hover:bg-black/25 group-hover:opacity-100">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white">
                  <Icon name={active && playing ? 'pause' : 'play'} size={18} />
                </span>
              </span>
            </button>

            <h3
              className={[
                'mt-2 line-clamp-2 text-[13px] leading-[1.45] transition-colors',
                active ? 'text-[var(--accent)]' : 'text-[var(--text-1)] group-hover:text-[var(--accent)]',
              ].join(' ')}
              title={track.title}
            >
              {track.title}
            </h3>

            <div className="mt-1 flex flex-wrap gap-1">
              {tagsOf(track.title).map((tag) => (
                <span
                  key={tag}
                  className="rounded-[2px] bg-[var(--panel-raised)] px-1.5 text-[10.5px] leading-[16px] text-[var(--text-2)]"
                >
                  #{tag}
                </span>
              ))}
            </div>

            <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-[var(--text-3)]">
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="user" size={11} />
                <span className="truncate" title={track.artist}>
                  {track.artist}
                </span>
              </span>
              {/* 三连：赞 / 币 / 藏，B 站最辨识的一组操作 */}
              <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Icon name="heart" size={12} className="hover:text-[var(--accent)]" />
                <span className="h-2.5 w-px bg-[var(--line)]" />
                <Icon name="coin" size={12} className="hover:text-[var(--accent)]" />
                <span className="h-2.5 w-px bg-[var(--line)]" />
                <button
                  type="button"
                  aria-label="看 MV"
                  title="看 MV"
                  onClick={() => setMv({ key: track.key, title: track.title })}
                  className="hover:text-[var(--accent)]"
                >
                  <Icon name="biliTv" size={12} />
                </button>
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}
