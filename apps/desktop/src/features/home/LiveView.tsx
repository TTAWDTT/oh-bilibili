import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'

/**
 * 直播频道。B 站直播区的一排房间就是这种密度：16:10 封面 + 主播 + 标题。
 *
 * 直播流（HLS + 播放鉴权）本机解不了，卡片点开交给系统浏览器；
 * 这里负责「看有哪些人在播」，不假装能播。
 */
export function LiveView() {
  const [rooms, setRooms] = useState<ipc.LiveRoom[]>([])
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pending = useRef(false)
  const pageRef = useRef(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback((next: number): void => {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    setError(null)
    void ipc
      .liveRooms(12, next)
      .then((list) => {
        pageRef.current = next
        setPage(next)
        setRooms((prev) => (next === 1 ? list : [...prev, ...list]))
      })
      .catch((cause) => setError(toWireError(cause).message))
      .finally(() => {
        pending.current = false
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load(1)
  }, [load])

  // 一屏装得下 12 个房间时滚动事件永远触发不了，取回一页后按剩余高度自己续。
  useEffect(() => {
    const box = boxRef.current
    if (!box || page === 0 || loading) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 200) load(page + 1)
  }, [page, loading, load, rooms.length])

  const more = (): void => {
    const box = boxRef.current
    if (!box || loading) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight > 600) return
    load(pageRef.current + 1)
  }

  if (page === 0 && loading) return <BiliLoader label="正在取直播间…" />
  if (page === 0 && error) {
    return (
      <EmptyState
        icon="alert"
        title="直播列表没取到"
        detail={error}
        action={{ label: '重试', onClick: () => load(1) }}
      />
    )
  }

  return (
    <div
      ref={boxRef}
      id="scroll-main"
      onScroll={more}
      className="bili-canvas min-h-0 flex-1 overflow-y-auto pb-10"
    >
      <nav className="mb-4 bg-[var(--panel)] px-4 py-4 md:px-8">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-medium text-[var(--text-1)]">直播</h2>
          <span className="flex items-center gap-1 rounded-[3px] bg-[var(--bili-pink)] px-1.5 text-[11px] leading-[17px] text-white">
            <span className="bili-live-dot" aria-hidden />
            LIVE
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-[12px] text-[var(--text-3)]">正在直播的房间</p>
          <button
            type="button"
            onClick={() => void ipc.openExternal('https://live.bilibili.com/').catch(() => {})}
            className="t press flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            <Icon name="info" size={12} />
            在浏览器里看
          </button>
        </div>
      </nav>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 md:px-8">
        {rooms.map((room) => (
          <button
            key={`${room.room_id}`}
            type="button"
            onClick={() => void ipc.openExternal(room.url).catch(() => {})}
            title={room.title}
            className="group min-w-0 text-left"
          >
            <span className="relative block overflow-hidden rounded-[6px] bg-[var(--ga1)]" style={{ aspectRatio: '16 / 10' }}>
              {room.cover ? (
                <img
                  src={room.cover}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-[220ms] group-hover:scale-[1.03]"
                />
              ) : null}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.62))]" />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-1.5 text-[11.5px] leading-[15px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                <span className="num flex min-w-0 items-center gap-1">
                  <span className="bili-live-bars" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="truncate">{room.watched || formatCount(room.online)}</span>
                </span>
                {room.area ? (
                  <span className="shrink-0 rounded-[2px] bg-black/45 px-1 [text-shadow:none]">{room.area}</span>
                ) : null}
              </span>
            </span>
            <span className="mt-1.5 flex items-center gap-1.5">
              <Avatar src={room.face} alt={room.uname} size={16} />
              <span className="truncate text-[12px] text-[var(--text-3)]">{room.uname}</span>
            </span>
            <span className="mt-1 line-clamp-2 min-h-[38px] text-[13.5px] leading-[19px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
              {room.title}
            </span>
          </button>
        ))}
      </div>
      {loading ? <BiliLoader compact label="正在取更多直播间…" /> : null}
      {error && page > 0 ? (
        <div className="flex justify-center py-3">
          <button
            type="button"
            onClick={() => load(pageRef.current + 1)}
            className="t press text-[12px] text-[var(--accent)] hover:underline"
          >
            没取到，重试
          </button>
        </div>
      ) : null}
    </div>
  )
}
