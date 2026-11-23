import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'

function LiveFeature({ room, hero }: { room: ipc.LiveRoom; hero: boolean }) {
  return (
    <button
      type="button"
      data-live-hero={hero ? room.room_id : undefined}
      data-live-room={hero ? undefined : room.room_id}
      onClick={() => void ipc.openExternal(room.url).catch(() => {})}
      title={room.title}
      className="t group flex min-w-0 flex-col text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <span
        className="relative block w-full overflow-hidden rounded-[8px] bg-[var(--ga1)]"
        style={{ aspectRatio: '16 / 9' }}
      >
        {room.cover ? (
          <img
            src={room.cover}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            className="h-full w-full object-contain"
          />
        ) : null}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-[3px] bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-medium leading-[16px] text-white">
          <span className="bili-live-dot" aria-hidden />
          LIVE
        </span>
      </span>
      <span
        className={[
          'mt-2 line-clamp-2 font-medium text-[var(--text-1)] group-hover:text-[var(--accent)]',
          hero ? 'text-[18px] leading-[26px]' : 'text-[13.5px] leading-[20px]',
        ].join(' ')}
      >
        {room.title}
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-3)]">
        <Avatar src={room.face} alt={room.uname} size={hero ? 20 : 16} />
        <span className="truncate">{room.uname}</span>
        <span className="num flex shrink-0 items-center gap-0.5">
          <Icon name="flame" size={11} />
          {formatCount(room.online)}
        </span>
        {hero ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <Icon name="external" size={12} />
            在浏览器打开
          </span>
        ) : null}
      </span>
    </button>
  )
}

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
  const [hasMore, setHasMore] = useState(true)
  const seen = useRef(new Set<number>())
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
        const fresh = list.filter((room) => {
          if (seen.current.has(room.room_id)) return false
          seen.current.add(room.room_id)
          return true
        })
        setHasMore(fresh.length > 0)
        setRooms((prev) => [...prev, ...fresh])
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
    if (!box || page === 0 || loading || error || !hasMore) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 200) load(page + 1)
  }, [page, loading, load, error, hasMore])

  const more = (): void => {
    const box = boxRef.current
    if (!box || loading || error || !hasMore) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight > 600) return
    load(pageRef.current + 1)
  }

  const lead = rooms[0]
  const side = rooms.slice(1, 3)
  const tail = rooms.slice(3)

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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-medium text-[var(--text-1)]">直播</h2>
            <span className="flex items-center gap-1 rounded-[3px] bg-[var(--accent)] px-1.5 text-[11px] leading-[17px] text-white">
              <span className="bili-live-dot" aria-hidden />
              LIVE
            </span>
          </div>
          <button
            type="button"
            onClick={() => void ipc.openExternal('https://live.bilibili.com/').catch(() => {})}
            className="t press flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            全部直播
            <Icon name="external" size={12} />
          </button>
        </div>
      </nav>
      {!lead && !loading && !error ? <EmptyState icon="biliTv" title="暂时没有直播间" action={null} /> : null}
      {lead ? (
        <div className="mb-5 px-4 md:px-8">
          <div
            className={
              side.length > 0
                ? 'grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
                : 'max-w-[720px]'
            }
          >
            <LiveFeature room={lead} hero />
            {side.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                {side.map((room) => (
                  <LiveFeature key={room.room_id} room={room} hero={false} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 md:px-8">
        {tail.map((room) => (
          <button
            key={`${room.room_id}`}
            type="button"
            data-live-room={room.room_id}
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
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-[3px] bg-[var(--accent)] px-1 text-[10px] leading-[16px] text-white">
                <span className="bili-live-dot" aria-hidden />
                LIVE
              </span>
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-1.5 text-[11.5px] leading-[15px] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                <span className="num flex min-w-0 items-center gap-1">
                  <Icon name="flame" size={12} />
                  <span className="truncate">{formatCount(room.online)}</span>
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
