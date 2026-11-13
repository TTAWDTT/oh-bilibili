import { formatCount } from '../../shared/lib/format'
import { partColor } from '../../shared/lib/biliParts'
import { FavPicker } from '../library/FavPicker'
import { useReactionStore } from '../reactions/reactionStore'
import { CardActions } from './CardActions'
import { CardDanmaku } from './CardDanmaku'
import { reportActionError } from '../../shared/lib/actionError'
import type React from 'react'
import { memo, useCallback, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toastDone } from '../../app/notice'
import { useAppStore } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { formatDuration } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { usePlayerStore } from '../player/playerStore'

/** 从标题里认出分辨率与音质角标。B 站自己在封面右上角标这些。 */
function coverFlags(title: string): string[] {
  const flags: string[] = []
  if (/8\s*k|4320/i.test(title)) flags.push('8K')
  else if (/4\s*k|2160/i.test(title)) flags.push('4K')
  else if (/1080/i.test(title)) flags.push('1080P')
  if (/60\s*fps|60帧/i.test(title)) flags.push('60FPS')
  if (/hdr/i.test(title)) flags.push('HDR')
  if (/hi-?res|hires/i.test(title)) flags.push('Hi-Res')
  if (/无损/.test(title)) flags.push('无损')
  if (/杜比|\(dolby\)/i.test(title)) flags.push('杜比')
  return flags.slice(0, 2)
}

/** 排行榜名次底色：1 红、2 橙、3 黄，其余半透明黑。 */
function rankTone(rank: number): string {
  if (rank === 1) return '#f25d8e'
  if (rank === 2) return '#ff8f3f'
  if (rank === 3) return '#f6c34a'
  return 'rgba(0,0,0,0.6)'
}

/** 搜索结果标题高亮：按字面切段，命中片段用 B 站搜索页那个粉，默认的 mark 黄底去掉。 */
function highlightTitle(title: string, keyword: string | undefined): React.ReactNode {
  const needle = keyword?.trim().toLowerCase() ?? ''
  if (needle.length === 0) return title
  const haystack = title.toLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (let hit = haystack.indexOf(needle); hit !== -1; hit = haystack.indexOf(needle, cursor)) {
    if (hit > cursor) parts.push(title.slice(cursor, hit))
    parts.push(
      <mark key={hit} className="bg-transparent text-[#fb7299]">
        {title.slice(hit, hit + needle.length)}
      </mark>,
    )
    cursor = hit + needle.length
  }
  if (parts.length === 0) return title
  parts.push(title.slice(cursor))
  return parts
}

type ContentGridProps = {
  tracks: Track[]
  activeKey: string | null
  playing: boolean
  /** 排行榜：封面左上角改画名次，前三名用 B 站的红/橙/黄。 */
  ranked?: boolean
  /** 额外动作（比如「从收藏夹移出」），渲染在动作行末尾。 */
  extraAction?: (track: Track) => React.ReactNode
  /** 已看进度 0~1。历史页用它画封面底部那条进度，没有就不画。 */
  progress?: (track: Track) => number | null
  /** 卡片推荐语，渲染在 UP 主下面一行。入站必刷用它，其它页面不传。 */
  note?: (track: Track) => string | null
  /** 搜索页传当前关键词，标题里命中的片段标粉；其它页面不传。 */
  highlight?: string
}

type CardProps = {
  track: Track
  index: number
  active: boolean
  playing: boolean
  ranked: boolean
  ratio: number | null
  noteText: string | null
  highlight: string | undefined
  confirming: boolean
  extra: React.ReactNode
  onOpen: (track: Track) => void
  onAuthor: (track: Track) => void
  onPlay: (index: number) => void
  onCoin: (track: Track) => void
  onFav: (track: Track, faved: boolean) => void
  onLater: (track: Track) => void
  onConfirmCoin: (track: Track) => void
  onCancelCoin: () => void
}

/**
 * 一张卡片。深预取会一次挂上上千张，翻页时只有新来的这一页该重新渲染，
 * 所以它必须靠 memo 稳住：传进来的都是数值、布尔和稳定的回调。
 */
const TrackCard = memo(function TrackCard({
  track,
  index,
  active,
  playing,
  ranked,
  ratio,
  noteText,
  highlight,
  confirming,
  extra,
  onOpen,
  onAuthor,
  onPlay,
  onCoin,
  onFav,
  onLater,
  onConfirmCoin,
  onCancelCoin,
}: CardProps) {
  return (
    <article data-track-card className="bili-card group">
      <div className="relative">
        <button
          type="button"
          onClick={() => onOpen(track)}
          aria-label={`观看 ${track.title}`}
          className="relative block w-full overflow-hidden rounded-[8px] border border-[var(--line)]"
          style={{ aspectRatio: '16 / 10' }}
        >
          <Cover cover={track.cover} title={track.title} width={260} className="bili-card-cover h-full w-full" />
          {ranked ? (
            <span
              className="absolute left-1 top-1 flex h-6 min-w-6 items-center justify-center rounded-[4px] px-1 text-[13px] font-semibold text-white"
              style={{ background: rankTone(index + 1) }}
            >
              {index + 1}
            </span>
          ) : track.tname ? (
            <span
              className="absolute left-1 top-1 rounded-[2px] px-1 text-[10px] leading-[15px] text-white"
              style={{ background: partColor(track.tname) }}
            >
              {track.tname}
            </span>
          ) : null}
          {coverFlags(track.title).length > 0 ? (
            <span className="absolute right-1 top-1 flex gap-1">
              {coverFlags(track.title).map((f) => (
                <span key={f} className="rounded-[2px] bg-black/65 px-1 text-[10px] leading-[15px] text-white">
                  {f}
                </span>
              ))}
            </span>
          ) : null}
          <CardDanmaku trackKey={track.key} />
          {/* B 站卡片的两枚角标：左下一行带三角的播放量，右下一格时长。
              播放量放封面上、正文行只留 UP 主，信息层级和网页端一致。 */}
          {ratio !== null && ratio > 0 && ratio < 1 ? (
            <span className="absolute inset-x-0 bottom-0 h-[4px] bg-black/45">
              <span
                className="block h-full bg-[var(--bili-pink)] shadow-[0_0_6px_rgba(251,114,153,0.45)]"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
          ) : null}
          <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-1 text-[12px] leading-[15px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
            <span className="num flex min-w-0 items-center gap-1">
              {track.views ? (
                <>
                  <Icon name="play" size={10} className="shrink-0" />
                  <span className="truncate">{formatCount(track.views)}</span>
                </>
              ) : null}
            </span>
            <span className="num shrink-0 rounded-[2px] bg-black/60 px-1 [text-shadow:none]">
              {formatDuration(track.duration_ms)}
            </span>
          </span>
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity duration-150 group-hover:bg-black/20 group-hover:opacity-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white">
              <Icon name={active && playing ? 'pause' : 'play'} size={18} />
            </span>
          </span>
        </button>

        <CardActions
          track={track}
          onListen={() => onPlay(index)}
          onCoin={() => onCoin(track)}
          onFav={(isFaved) => onFav(track, isFaved)}
          onLater={() => onLater(track)}
          extraAction={extra}
        />
      </div>

      <h3
        className={[
          'mt-2 line-clamp-2 min-h-[2.7em] text-[15px] leading-[1.35] transition-colors',
          active ? 'text-[var(--accent)]' : 'text-[var(--text-1)] group-hover:text-[var(--accent)]',
        ].join(' ')}
        title={track.title}
      >
        <button type="button" onClick={() => onOpen(track)} className="line-clamp-2 text-left">
          {highlightTitle(track.title, highlight)}
        </button>
      </h3>

      <div className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--text-3)]">
        <button
          type="button"
          title={`看 ${track.artist} 的更多视频`}
          onClick={() => onAuthor(track)}
          className="flex min-w-0 items-center gap-1 hover:text-[var(--accent)]"
        >
          <Avatar src={track.up_avatar ?? null} alt={track.artist} size={18} />
          <span className="truncate">{track.artist}</span>
        </button>
      </div>

      {noteText ? <p className="mt-0.5 line-clamp-1 text-[12px] text-[var(--text-3)]">{noteText}</p> : null}

      {confirming ? (
        <div className="mt-1.5 flex items-center gap-2 rounded-[4px] bg-[var(--panel-raised)] px-2 py-1 text-[12px]">
          <span className="text-[var(--text-2)]">投 1 枚硬币？不可撤销</span>
          <button
            type="button"
            onClick={() => onConfirmCoin(track)}
            className="rounded-[3px] bg-[var(--accent)] px-2 text-white"
          >
            投
          </button>
          <button type="button" onClick={onCancelCoin} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            取消
          </button>
        </div>
      ) : null}
    </article>
  )
})

/**
 * B 站风格的封面卡片网格。
 *
 * 视频网站的身份是「封面主导」，不是「行主导」。这里照着 B 站网页端的比例做：
 * 16:10 封面、圆角 6px、播放量压左下角、时长压右下角、标题两行、UP 主一行灰字。
 */
export function ContentGrid({ tracks, activeKey, playing, ranked, extraAction, progress, note, highlight }: ContentGridProps) {
  const playContext = usePlayerStore((state) => state.playContext)
  const navigate = useAppStore((state) => state.navigate)
  const toggleFav = useReactionStore((state) => state.toggleFav)
  const addCoin = useReactionStore((state) => state.addCoin)
  const favToStore = useReactionStore((state) => state.favTo)

  /** 投币不可撤销，B 站硬币还是稀缺资源，所以必须二次确认。 */
  const [confirming, setConfirming] = useState<string | null>(null)
  // 收藏前先选收藏夹；未收藏 → 弹选择；已收藏 → 直接取消
  const [picking, setPicking] = useState<Track | null>(null)
  const [favBusy, setFavBusy] = useState(false)

  // 「听」是整列排队播放：回调里要拿到最新的曲目表，但又不能让回调本身每页都换新，
  // 否则 memo 的卡片会被整片作废。所以曲目表放 ref 里，回调只建一次。
  const keysRef = useRef<string[]>([])
  keysRef.current = tracks.map((t) => t.key)

  const onOpen = useCallback((track: Track) => navigate({ kind: 'watch', track }), [navigate])
  const onAuthor = useCallback(
    (track: Track) => navigate({ kind: 'author', name: track.artist, mid: track.up_mid ?? null }),
    [navigate],
  )
  const onPlay = useCallback((index: number) => void playContext(keysRef.current, index), [playContext])
  const onCoin = useCallback((track: Track) => setConfirming(track.key), [])
  const onConfirmCoin = useCallback(
    (track: Track) => {
      setConfirming(null)
      void addCoin(track, 1)
    },
    [addCoin],
  )
  const onCancelCoin = useCallback(() => setConfirming(null), [])
  const onFav = useCallback(
    (track: Track, isFaved: boolean) => {
      if (isFaved) void toggleFav(track)
      else setPicking(track)
    },
    [toggleFav],
  )
  const onLater = useCallback((track: Track) => {
    // 稍后再看：写进 B 站账号的待看列表。
    void ipc
      .watchLaterSet(track.key, true)
      .then(() => toastDone('已加入稍后再看'))
      .catch((cause: unknown) => reportActionError('稍后再看', cause))
  }, [])

  /** 收进选定收藏夹。folderId 为 null 表示默认夹。 */
  const favTo = async (folderId: number | null): Promise<void> => {
    const track = picking
    if (!track) return
    setFavBusy(true)
    try {
      await favToStore(track, folderId)
      toastDone('已收藏', folderId === null ? '收进了默认收藏夹' : '已收进所选收藏夹')
      setPicking(null)
    } catch {
      // store 里已经提示过，这里只负责收尾
    } finally {
      setFavBusy(false)
    }
  }

  return (
    <>
      <h2 className="sr-only">曲目</h2>
      <div className="grid gap-x-5 gap-y-7 pb-6 [grid-template-columns:repeat(auto-fill,minmax(206px,1fr))]">
        {tracks.map((track, index) => {
          const active = track.key === activeKey
          return (
            <TrackCard
              key={track.key}
              track={track}
              index={index}
              active={active}
              /* 只有正在播的那一张会用到 playing，别的卡传固定的 false，
                 这样播放/暂停时 memo 不会把整列上千张卡全部重渲染。 */
              playing={active && playing}
              ranked={ranked === true}
              ratio={progress?.(track) ?? null}
              noteText={note?.(track) ?? null}
              highlight={highlight}
              confirming={confirming === track.key}
              extra={extraAction ? extraAction(track) : null}
              onOpen={onOpen}
              onAuthor={onAuthor}
              onPlay={onPlay}
              onCoin={onCoin}
              onFav={onFav}
              onLater={onLater}
              onConfirmCoin={onConfirmCoin}
              onCancelCoin={onCancelCoin}
            />
          )
        })}
        {picking ? (
          <FavPicker open busy={favBusy} onClose={() => setPicking(null)} onPick={(folderId) => void favTo(folderId)} />
        ) : null}
      </div>
    </>
  )
}
