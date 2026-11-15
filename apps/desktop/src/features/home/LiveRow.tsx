import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { useAppStore } from '../../app/appStore'

/** 直播卡上的封面比例。B 站直播间是 16:10，比视频的 16:9 高一点。 */
const COVER_RATIO = '16 / 10'

/**
 * 发现页底部的「正在直播」。
 *
 * 直播流本机解码不了（HLS + 私有鉴权），所以卡片点开交给系统浏览器，
 * 和 B 站首页那块推荐位的信息密度一致：封面、分区胶囊、人气、主播。
 */
export function LiveRow() {
  const navigate = useAppStore((state) => state.navigate)
  const [rooms, setRooms] = useState<ipc.LiveRoom[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void ipc
      .liveRooms(6, 1)
      .then((list) => {
        if (!cancelled) setRooms(list)
      })
      .catch((cause) => {
        // 直播是加的一层气氛，取不到就整块不出现，不在发现页报错抢占版面
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error || !rooms || rooms.length === 0) return null

  return (
    <section className="mt-8 px-4 md:px-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-medium text-[var(--text-1)]">正在直播</h2>
          {/* 一颗会呼吸的红点：B 站用它在标题旁表达「现在是活的」 */}
          <span className="flex items-center gap-1 rounded-[3px] bg-[var(--accent)] px-1.5 text-[11px] leading-[17px] text-white">
            <span className="bili-live-dot" aria-hidden />
            LIVE
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate({ kind: 'live' })}
          className="t press flex items-center gap-1 text-[12.5px] text-[var(--text-3)] hover:text-[var(--accent)]"
        >
          全部直播
          <span aria-hidden>›</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {rooms.map((room) => (
          <button
            key={room.room_id}
            type="button"
            onClick={() => void ipc.openExternal(room.url).catch(() => {})}
            title={room.title}
            className="group min-w-0 text-left"
          >
            <span className="relative block overflow-hidden rounded-[6px] bg-[var(--ga1)]" style={{ aspectRatio: COVER_RATIO }}>
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
              {/* 底部压一层渐变：直播封面亮底很多，白字直接贴上去读不出来 */}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.62))]" />
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
            <span className="mt-1 line-clamp-1 text-[13.5px] leading-[19px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
              {room.title}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
