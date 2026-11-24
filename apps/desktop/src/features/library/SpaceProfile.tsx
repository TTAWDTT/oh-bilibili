import { useEffect, useState } from 'react'
import { toastFailure } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { MedalWall } from './MedalWall'
import { useAuthStore } from '../auth/authStore'
import { Icon } from '../../shared/ui/Icon'

function useSpaceField<T>(mid: number | null | undefined, load: (mid: number) => Promise<T>, enabled = true) {
  const [value, setValue] = useState<T>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || !mid) return
    let active = true
    setFailed(false)
    void load(mid).then((next) => {
      if (active) setValue(next)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [mid, load, enabled, attempt])
  return { value, failed, retry: () => setAttempt((n) => n + 1) }
}

export function useSpaceProfile(mid: number | null | undefined) {
  const [requested, setRequested] = useState(false)
  const profile = useSpaceField(mid, ipc.spaceProfile, requested)
  return { ...profile, request: () => setRequested(true) }
}

const link = 'inline-flex max-w-full items-center gap-1 text-[var(--accent)] hover:underline'

function open(url: string) {
  void ipc.openExternal(url).catch((cause) => toastFailure('打开 B 站', cause))
}

export function SpaceProfile({ mid, card, isSelf, profile }: {
  mid: number
  card: ipc.AuthorCard | null
  isSelf: boolean
  profile: ReturnType<typeof useSpaceProfile>
}) {
  const [expanded, setExpanded] = useState(false)
  const room = useSpaceField(mid, ipc.spaceRoom)
  const notice = useSpaceField(mid, ipc.spaceNotice)
  const account = useAuthStore((state) => state.auth?.user?.mid)
  const details = profile.value
  const medal = details?.fans_medal
  const charge = details?.charging
  const plate = card?.dress?.nameplate
  const liveRoom = room.value
  const roomLabel = liveRoom?.live ? '直播中' : liveRoom?.looping ? '轮播中' : '直播间'
  return (
    <div className="min-w-0 space-y-2 text-[12.5px] text-[var(--text-2)]">
      {notice.value && <p data-space-notice className={`whitespace-pre-line break-words ${expanded ? '' : 'line-clamp-2'}`}>
        <strong className="mr-2 font-medium text-[var(--text-1)]">公告</strong>{notice.value}
      </p>}
      {liveRoom && <button type="button" aria-label={`打开直播间：${liveRoom.title ?? liveRoom.id}`}
        onClick={() => open(`https://live.bilibili.com/${liveRoom.id}`)}
        className="group flex max-w-full items-center gap-2 text-left">
        {liveRoom.cover && <img src={liveRoom.cover} alt="" referrerPolicy="no-referrer" loading="lazy"
          className="h-8 w-[54px] shrink-0 rounded object-cover" />}
        <span className="min-w-0"><span className="block text-[11px] text-[var(--text-3)]">{roomLabel}</span>
          <span className="block truncate font-medium group-hover:text-[var(--accent)]">{liveRoom.title ?? `房间 ${liveRoom.id}`}</span>
        </span><Icon name="external" size={12} />
      </button>}
      <button type="button" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); profile.request() }}
        className="inline-flex min-h-6 items-center gap-1 hover:text-[var(--accent)]">
        空间资料<span className={expanded ? '-rotate-90' : 'rotate-90'}><Icon name="chevronRight" size={12} /></span>
      </button>
      {expanded && <section aria-label="空间资料" className="space-y-2 border-t border-[var(--line)] pt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>UID {mid}</span>
          {details?.sex && <span>性别 {details.sex}</span>}
          {details?.birthday && <span>生日 {details.birthday}</span>}
          {details?.profession && <span>{details.profession}</span>}
          {details?.school && <span>学校 {details.school}</span>}
        </div>
        {plate && <div className="flex items-center gap-2">
          <img src={plate.image} alt="" width={38} height={38} referrerPolicy="no-referrer" />
          <div><span className="font-medium">{plate.name}</span>
            {plate.condition && <p className="text-[var(--text-3)]">{plate.condition}</p>}</div>
        </div>}
        {medal && <span title="佩戴的粉丝勋章" className="inline-flex items-center gap-1 rounded border border-current px-1.5 font-medium"
          style={{ color: medal.color ?? undefined, backgroundColor: medal.background ?? undefined }}>{medal.name} {medal.level}</span>}
        <MedalWall key={`${mid}:${account ?? 0}`} mid={mid} />
        {charge && !isSelf && <div className="flex items-center gap-2"><button type="button" className={link} onClick={() => open(charge.url)}>
          {charge.icon ? <img src={charge.icon} alt="" width={17} height={17} referrerPolicy="no-referrer" /> : <Icon name="battery" size={16} />}
          充电
        </button>{charge.count != null && <span className="text-[var(--text-3)]">{formatCount(charge.count)} 人充电</span>}</div>}
        {profile.failed ? <button type="button" className={link} onClick={profile.retry}>重新加载空间资料</button>
          : !details && <p role="status" className="text-[var(--text-3)]">正在读取空间资料…</p>}
        {notice.failed && <button type="button" className={link} onClick={notice.retry}>重新加载公告</button>}
        {room.failed && <button type="button" className={link} onClick={room.retry}>重新加载直播间</button>}
        <div><button type="button" className={link} onClick={() => open(`https://space.bilibili.com/${mid}`)}>去 B 站空间查看勋章<Icon name="external" size={12} /></button></div>
      </section>}
    </div>
  )
}
