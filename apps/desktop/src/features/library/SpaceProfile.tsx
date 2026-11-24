import { useEffect, useState } from 'react'
import { toastFailure } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { MedalWall } from './MedalWall'
import { useAuthStore } from '../auth/authStore'
import { Icon } from '../../shared/ui/Icon'
import './space-profile.css'

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

export function SpaceProfile({ mid, card, isSelf, profile, hidden }: {
  hidden: boolean
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
    <aside hidden={hidden} aria-label="作者资料栏" className="space-profile" data-expanded={expanded}>
      <button type="button" aria-expanded={expanded}
        onClick={() => { setExpanded(!expanded); if (!expanded) profile.request() }}
        className="space-profile-heading w-full py-2 text-left hover:text-[var(--accent-strong)]">
        <Icon name="profileBadge" size={20} />空间资料
        <Icon name="chevronRight" size={14} className={`ml-auto text-[var(--text-3)] ${expanded ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {notice.value && <section className="space-profile-summary">
        <h3 className="space-profile-heading"><Icon name="creatorPen" size={20} />公告</h3>
        <p data-space-notice className={`mt-2 whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}>{notice.value}</p>
      </section>}
      {liveRoom && <section className="space-profile-summary">
        <h3 className="space-profile-heading"><Icon name="liveCamera" size={20} />{roomLabel}</h3>
        <button type="button" aria-label={`打开直播间：${liveRoom.title ?? liveRoom.id}`}
          onClick={() => open(`https://live.bilibili.com/${liveRoom.id}`)}
          className="group mt-2 flex w-full items-center gap-2 text-left hover:text-[var(--accent-strong)]">
          {liveRoom.cover && <img src={liveRoom.cover} alt="" referrerPolicy="no-referrer" loading="lazy"
            className="h-9 w-16 shrink-0 rounded object-cover" />}
          <span className="line-clamp-2 min-w-0">{liveRoom.title ?? `房间 ${liveRoom.id}`}</span>
          <Icon name="external" size={12} className="ml-auto shrink-0 text-[var(--text-3)] group-hover:text-current" />
        </button>
      </section>}
      {expanded && <section aria-label="空间资料" className="space-y-3 pb-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>UID</dt><dd>{mid}</dd>
          {details?.sex && <><dt>性别</dt><dd>{details.sex}</dd></>}
          {details?.birthday && <><dt>生日</dt><dd>{details.birthday}</dd></>}
          {details?.profession && <><dt>职业</dt><dd>{details.profession}</dd></>}
          {details?.school && <><dt>学校</dt><dd>{details.school}</dd></>}
        </dl>
        {plate && <div className="flex items-center gap-2">
          <img src={plate.image} alt="" width={38} height={38} className="shrink-0" referrerPolicy="no-referrer" />
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
    </aside>
  )
}
