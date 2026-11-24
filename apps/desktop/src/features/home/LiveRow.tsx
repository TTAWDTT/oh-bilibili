import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount } from '../../shared/lib/format'
import { toastFailure } from '../../app/notice'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { useAppStore } from '../../app/appStore'
import './discovery-shelves.css'

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
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error || !rooms || rooms.length === 0) return null

  return (
    <section className="discovery-shelf px-4 md:px-8" aria-labelledby="home-live-heading">
      <div className="discovery-shelf-heading">
        <h2 id="home-live-heading" className="discovery-heading">正在直播</h2>
        <span className="discovery-browser-note"><Icon name="external" size={12} />在浏览器观看</span>
        <button type="button" onClick={() => navigate({ kind: 'live' })}>
          全部直播 <Icon name="chevronRight" size={14} />
        </button>
      </div>
      <div className="discovery-live-rooms">
        {rooms.map((room) => (
          <button
            key={room.room_id}
            type="button"
            data-live-room={room.room_id}
            onClick={() => void ipc.openExternal(room.url).catch((cause) => toastFailure('打开直播间', cause))}
            title={`${room.title} · 在浏览器打开`}
            className="discovery-live-room group"
          >
            <span className="discovery-landscape-cover">
              {room.cover && (
                <img src={room.cover} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
              )}
              <span className="discovery-cover-stats num">
                <Icon name="flame" size={12} />{formatCount(room.online)}
              </span>
              <span className="discovery-open-label">在浏览器打开 <Icon name="external" size={11} /></span>
            </span>
            <span className="discovery-card-title">{room.title}</span>
            <span className="discovery-card-meta">
              <Avatar src={room.face} alt="" size={16} />
              <span className="truncate">{room.uname}</span>
              {room.area && <span className="truncate">{room.area}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
