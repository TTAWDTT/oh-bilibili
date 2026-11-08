import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { formatDuration } from '../../shared/lib/format'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { usePlayerStore } from '../player/playerStore'

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
  const play = usePlayerStore((state) => state.play)
  const playContext = usePlayerStore((state) => state.playContext)
  const setMv = useAppStore((state) => state.setMv)
  const setStage = useAppStore((state) => state.setStage)

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

            <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-[var(--text-3)]">
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="user" size={11} />
                <span className="truncate" title={track.artist}>
                  {track.artist}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="看 MV"
                  title="看 MV"
                  onClick={() => setMv({ key: track.key, title: track.title })}
                  className="hover:text-[var(--accent)]"
                >
                  <Icon name="biliTv" size={12} />
                </button>
                <button
                  type="button"
                  aria-label="进舞台"
                  title="进舞台"
                  onClick={() => {
                    void play(track.key)
                    setStage(true)
                  }}
                  className="hover:text-[var(--accent)]"
                >
                  <Icon name="lyrics" size={12} />
                </button>
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}
