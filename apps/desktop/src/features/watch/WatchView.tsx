import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track, WatchView as WatchData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { toDanmakuItems } from '../player/DanmakuField'
import type { DanmakuItem } from '../player/DanmakuField'
import { useReactionStore } from '../reactions/reactionStore'
import { CommentsPanel } from './CommentsPanel'
import { RelatedAside } from './RelatedAside'
import { WatchInfo } from './WatchInfo'
import { WatchPlayer } from './WatchPlayer'
import { Icon } from '../../shared/ui/Icon'

/**
 * 观看页。只负责取数与拼装：播放器、信息区、评论区、右栏各是一块。
 *
 * 声音只有一个发声者，就是音频引擎；画面跟着引擎的时钟走。
 * 清单与分片都走本机代理，前端拿不到任何远端地址。
 */
export function WatchView({ track }: { track: Track }) {
  const goBack = useAppStore((s) => s.goBack)
  const [data, setData] = useState<WatchData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([])
  const [related, setRelated] = useState<Track[]>([])
  const refresh = useReactionStore((st) => st.refresh)
  const [page, setPage] = useState<number | undefined>(undefined)

  // 取清单与档位
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    void (async () => {
      try {
        const next = await ipc.watchOpen(track.key, page)
        if (!cancelled) setData(next)
      } catch (e) {
        if (!cancelled) setError(toWireError(e).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [track.key, page])

  // 取弹幕。时间轴跟引擎时钟走，画面只是它的跟随者。
  useEffect(() => {
    let cancelled = false
    setDanmaku([])
    void ipc
      .danmakuColored(track.key)
      .then((list) => {
        if (!cancelled) setDanmaku(toDanmakuItems(list))
      })
      .catch(() => setDanmaku([]))
    return () => {
      cancelled = true
    }
  }, [track.key])

  // 打开就把这条视频的真实点赞/收藏/投币状态拉回来，
  // 否则按钮看起来永远是未点过的。
  useEffect(() => {
    // 用 refresh 而不是 hydrate：hydrate 会跳过查过的 key，而详情页
    // 打开时必须显示服务端真实状态，不能吃缓存。
    void refresh([track.key]).catch(() => {
      // 未登录时拉不到，保持未点亮即可
    })
  }, [track.key, refresh])

  // 相关推荐。右栏只在「听」时出现，所以观看页要有自己的一份，
  // 否则看视频时完全没有相关推荐可点。
  useEffect(() => {
    let cancelled = false
    setRelated([])
    void ipc
      .related(track.key)
      .then((list) => {
        if (!cancelled) setRelated(list)
      })
      .catch(() => setRelated([]))
    return () => {
      cancelled = true
    }
  }, [track.key])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <button
          type="button"
          aria-label="返回"
          onClick={() => goBack()}
          className="t press flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[var(--panel-alt)]"
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium">{track.title}</h2>
        <button
          type="button"
          onClick={() => {
            const at = Math.round(readPlayhead())
            void ipc.setMode('listen', at, track.key).then(() => goBack()).catch(() => {})
          }}
          className="t press shrink-0 rounded-[6px] border border-[var(--line)] px-2 py-1 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)]"
        >
          听视频
        </button>
        <span className="num shrink-0 text-[12px] text-[var(--text-3)]">
          {track.duration_ms ? formatTime(track.duration_ms) : '—'}
        </span>
      </div>

      {/* 左画面右推荐的布局：视频客户端的信息骨架，音乐播放器那套单列竖排不适用。 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col">
          {data ? (
            <WatchPlayer
              track={track}
              data={data}
              danmaku={danmaku}
              onDanmakuSent={(item) => setDanmaku((prev) => [...prev, item])}
            />
          ) : (
            <div className="aspect-video w-full shrink-0 bg-black" />
          )}
          {error ? (
            <p className="border-b border-hairline px-3 py-2 text-[12px] text-[var(--text-3)]">
              这条视频没打开：{error}
            </p>
          ) : null}
          {data ? <WatchInfo track={track} data={data} onPage={setPage} /> : null}
          {/* 右栏在窄屏收起，推荐改到评论区上方，否则手机上看完这条就没有下一个可点。 */}
          <div className="border-t border-hairline md:hidden">
            <RelatedAside items={related} />
          </div>
          <div className="min-h-0 flex-1 border-t border-hairline">
            <CommentsPanel trackKey={track.key} />
          </div>
        </div>

        <aside className="hidden min-h-0 w-[340px] shrink-0 overflow-y-auto border-l border-hairline md:block">
          <RelatedAside items={related} />
        </aside>
      </div>
    </div>
  )
}
