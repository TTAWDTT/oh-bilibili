import { DownloadButton } from '../downloads/DownloadButton'
import { FavPicker } from '../library/FavPicker'
import { useReactionStore } from '../reactions/reactionStore'
import { reportActionError } from '../../shared/lib/actionError'
import type React from 'react'
import { useEffect, useState } from 'react'
import { copyText } from '../../shared/lib/clipboard'
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

/** 分区胶囊：从标题推断，没有标签的视频不显示。 */
/** B 站的计数写法：一万以上用「万」。 */
function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(n)
}

/** B 站各分区的代表色，用于分区标签底色。 */
function partitionColor(name: string): string {
  const table: Record<string, string> = {
    音乐: '#fca39a',
    舞蹈: '#ff6699',
    游戏: '#53b6ff',
    鬼畜: '#ff8f6b',
    动画: '#ffa3b6',
    生活: '#ffb027',
    影视: '#ffa0a0',
    电影: '#ff8f9c',
    电视剧: '#ff8fa3',
    搞笑: '#ffd05b',
    科技: '#00aeec',
    数码: '#00aeec',
    美食: '#f6c34a',
    动物: '#8bd28b',
    时尚: '#ff9ec4',
    娱乐: '#ff9ec4',
  }
  return table[name] ?? '#9499a0'
}

type TrackGridProps = {
  tracks: Track[]
  activeKey: string | null
  playing: boolean
  /** 额外动作（比如「从收藏夹移出」），渲染在动作行末尾。 */
  extraAction?: (track: Track) => React.ReactNode
}

/**
 * B 站风格的封面卡片网格。
 *
 * 视频网站的身份是「封面主导」，不是「行主导」。这里照着 B 站网页端的比例做：
 * 16:10 封面、圆角 6px、时长压右下角、标题两行、UP 主一行灰字，hover 时标题变粉。
 */
export function TrackGrid({ tracks, activeKey, playing, extraAction }: TrackGridProps) {
  const playContext = usePlayerStore((state) => state.playContext)
  const setMv = useAppStore((state) => state.setMv)
  const navigate = useAppStore((state) => state.navigate)
  const liked = useReactionStore((state) => state.liked)
  const faved = useReactionStore((state) => state.faved)
  const toggleLike = useReactionStore((state) => state.toggleLike)
  const toggleFav = useReactionStore((state) => state.toggleFav)
  const hydrate = useReactionStore((state) => state.hydrate)
  const coins = useReactionStore((state) => state.coins)
  const addCoin = useReactionStore((state) => state.addCoin)
  const favToStore = useReactionStore((state) => state.favTo)

  // 进到一屏结果就把这一屏的真实点赞/收藏状态拉回来，心与星不会再是「重置后全空」。
  useEffect(() => {
    const keys = tracks.slice(0, 20).map((t) => t.key)
    if (keys.length === 0) return
    void hydrate(keys).catch(() => {
      // 未登录或限流时保持现状，不打扰用户
    })
  }, [tracks, hydrate])

  /** 稍后再看：写进 B 站账号的待看列表。 */
  const later = async (track: Track): Promise<void> => {
    try {
      await ipc.watchLaterSet(track.key, true)
      toastDone('已加入稍后再看')
    } catch (e) {
      reportActionError('稍后再看', e)
    }
  }

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

  /** 投币不可撤销，B 站硬币还是稀缺资源，所以必须二次确认。 */
  const [confirming, setConfirming] = useState<string | null>(null)
  // 收藏前先选收藏夹；未收藏 → 弹选择；已收藏 → 直接取消
  const [picking, setPicking] = useState<Track | null>(null)
  const [favBusy, setFavBusy] = useState(false)

  const doCoin = async (track: Track): Promise<void> => {
    setConfirming(null)
    await addCoin(track, 1)
  }

  return (
    <>
      <h2 className="sr-only">曲目</h2>
        <div className="grid gap-x-4 gap-y-6 pb-6 [grid-template-columns:repeat(auto-fill,minmax(226px,1fr))]">
      {tracks.map((track, index) => {
        const active = track.key === activeKey
        return (
          <article
            key={track.key}
            className="bili-card bili-card-enter group"
            style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => void playContext(tracks.map((t) => t.key), index)}
              aria-label={`播放 ${track.title}`}
              className="bili-press relative block w-full overflow-hidden rounded-[8px] border border-[var(--line)]"
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
              <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/65 px-1 text-[12px] leading-[15px] text-white">
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
                'mt-2 line-clamp-2 text-[15px] leading-[1.4] transition-colors',
                active ? 'text-[var(--accent)]' : 'text-[var(--text-1)] group-hover:text-[var(--accent)]',
              ].join(' ')}
              title={track.title}
            >
              {track.title}
            </h3>

            {track.views ? (
              <div className="num mt-1.5 flex items-center gap-2 text-[13px] text-[var(--text-3)]">
                {track.tname ? (
                  <span
                    className="rounded-[3px] px-1.5 text-[11.5px] leading-[16px] text-white"
                    style={{ background: partitionColor(track.tname) }}
                  >
                    {track.tname}
                  </span>
                ) : null}
                <span className="flex items-center gap-1">
                  <Icon name="play" size={10} />
                  {formatCount(track.views)}
                </span>
                {track.danmaku ? (
                  <span className="flex items-center gap-1">
                    <Icon name="queue" size={10} />
                    {formatCount(track.danmaku)}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-1 flex items-center justify-between gap-2">
              <button
                type="button"
                title="点击复制 BV 号"
                onClick={() => void copyText(track.key).then((ok) => ok && toastDone('已复制 BV 号'))}
                className="num truncate font-mono text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                {track.key}
              </button>
              <button
                type="button"
                aria-label={`看 ${track.title} 的 MV`}
                title="看 MV"
                onClick={() => setMv({ key: track.key, title: track.title })}
                className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
              >
                <Icon name="biliTv" size={11} />
                MV
              </button>
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-2 text-[14px] text-[var(--text-3)]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Avatar src={track.up_avatar ?? null} alt={track.artist} size={16} />
                <button
                  type="button"
                  title={`看 ${track.artist} 的更多视频`}
                  onClick={(event) => {
                    event.stopPropagation()
                    navigate({ kind: 'author', name: track.artist, mid: track.up_mid ?? null })
                  }}
                  className="truncate hover:text-[var(--accent)] hover:underline"
                >
                  {track.artist}
                </button>
              </span>
              {/* 三连：赞 / 币 / 藏，都是真接口，不是装饰 */}
              <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={(liked[track.key] ?? false) ? '取消点赞' : '点赞'}
                  aria-pressed={liked[track.key] ?? false}
                  title={(liked[track.key] ?? false) ? '取消点赞' : '点赞'}
                  onClick={() => void toggleLike(track)}
                  className={[
                    'bili-icon-hover',
                    liked[track.key] ? 'text-[var(--accent)]' : 'hover:text-[var(--accent)]',
                  ].join(' ')}
                >
                  <Icon name={(liked[track.key] ?? false) ? 'thumbFilled' : 'thumb'} size={12} />
                </button>
                <span className="h-2.5 w-px bg-[var(--line)]" />
                <button
                  type="button"
                  aria-label={(coins[track.key] ?? 0) > 0 ? `已投 ${coins[track.key]} 枚币` : '投币'}
                  title={
                    (coins[track.key] ?? 0) >= 2
                      ? '已经投满 2 枚'
                      : (coins[track.key] ?? 0) > 0
                        ? `已投 ${coins[track.key]} 枚，还能投 ${2 - (coins[track.key] ?? 0)} 枚`
                        : '投币'
                  }
                  disabled={(coins[track.key] ?? 0) >= 2}
                  onClick={() => setConfirming(track.key)}
                  className={[
                    'bili-icon-hover',
                    (coins[track.key] ?? 0) > 0
                      ? 'text-[#ffc46b]'
                      : 'hover:text-[var(--accent)]',
                    (coins[track.key] ?? 0) >= 2 ? 'cursor-default opacity-50' : '',
                  ].join(' ')}
                >
                  <Icon name="coin" size={12} />
                </button>
                <span className="h-2.5 w-px bg-[var(--line)]" />
                <button
                  type="button"
                  aria-label={(faved[track.key] ?? false) ? '取消收藏' : '收藏'}
                  aria-pressed={faved[track.key] ?? false}
                  title={(faved[track.key] ?? false) ? '取消收藏' : '收藏'}
                  onClick={() => {
                    if (faved[track.key]) void toggleFav(track)
                    else setPicking(track)
                  }}
                  className={[
                    'bili-icon-hover',
                    faved[track.key] ? 'text-[#ffc46b]' : 'hover:text-[var(--accent)]',
                  ].join(' ')}
                >
                  <Icon name="bookmarkStar" size={12} />
                </button>
                <span className="h-2.5 w-px bg-[var(--line)]" />
                <button
                  type="button"
                  aria-label="稍后再看"
                  title="稍后再看"
                  onClick={() => void later(track)}
                  className="bili-icon-hover hover:text-[var(--accent)]"
                >
                  <Icon name="watchLater" size={12} />
                </button>
                <span className="h-2.5 w-px bg-[var(--line)]" />
                <DownloadButton trackKey={track.key} size={12} />
                {extraAction ? (
                  <>
                    <span className="h-2.5 w-px bg-[var(--line)]" />
                    {extraAction(track)}
                  </>
                ) : null}
              </span>
            </div>

      {confirming === track.key ? (
              <div className="mt-1 flex items-center gap-2 rounded-[4px] bg-[var(--panel-raised)] px-2 py-1 text-[12px]">
                <span className="text-[var(--text-2)]">投 1 枚硬币？不可撤销</span>
                <button
                  type="button"
                  onClick={() => void doCoin(track)}
                  className="rounded-[3px] bg-[var(--accent)] px-2 text-white"
                >
                  投
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="text-[var(--text-3)] hover:text-[var(--text-1)]"
                >
                  取消
                </button>
              </div>
            ) : null}
          </article>
        )
      })}
      {picking ? (
        <FavPicker
          open
          busy={favBusy}
          onClose={() => setPicking(null)}
          onPick={(folderId) => void favTo(folderId)}
        />
      ) : null}
    </div>
    </>
  )
}
