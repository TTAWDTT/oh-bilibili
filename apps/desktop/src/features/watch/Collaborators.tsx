import { useState } from 'react'
import { useAppStore } from '../../app/appStore'
import type { WatchStaff } from '../../shared/lib/contract'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { rememberWatchScroll } from './watchScroll'

type Member = { mid: number | null; name: string; face: string | null; roles: string[] }

/** 展开状态按 BV 记住：从成员空间回来，名单仍是展开的。 */
const expandedMemory = new Map<string, boolean>()

/** 同一 MID 兼任多个角色合并；同名但 MID 不同的分列。 */
function mergeStaff(staff: WatchStaff[]): Member[] {
  const list: Member[] = []
  const byKey = new Map<string, Member>()
  for (const entry of staff) {
    const name = entry.name.trim()
    if (!name) continue
    const key = entry.mid !== null ? `mid:${entry.mid}` : `name:${name}`
    const title = entry.title.trim()
    const existing = byKey.get(key)
    if (existing) {
      if (title && !existing.roles.includes(title)) existing.roles.push(title)
      continue
    }
    const member: Member = {
      mid: entry.mid,
      name,
      face: entry.face,
      roles: title ? [title] : [],
    }
    byKey.set(key, member)
    list.push(member)
  }
  return list
}

/**
 * 联合投稿署名。单作者稿件不渲染；只有带 MID 的成员能进空间。
 * 简介里的其他名字不会被补进来，这里只认接口给出的 staff。
 */
export function Collaborators({ trackKey, staff }: { trackKey: string; staff: WatchStaff[] }) {
  const navigate = useAppStore((state) => state.navigate)
  const members = mergeStaff(staff)
  const [expanded, setExpanded] = useState(() => expandedMemory.get(trackKey) ?? false)

  if (members.length === 0) return null
  const preview = members.slice(0, 2)
  const rest = members.length - preview.length

  const toggle = (): void => {
    const next = !expanded
    expandedMemory.set(trackKey, next)
    setExpanded(next)
  }

  const open = (member: Member): void => {
    if (member.mid === null) return
    rememberWatchScroll(trackKey)
    navigate({ kind: 'author', name: member.name, mid: member.mid })
  }

  return (
    <div data-collaborators className="border-t border-hairline pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-3)]">
        <span className="shrink-0 rounded-[3px] bg-[var(--panel-raised)] px-1.5 leading-[18px] text-[var(--text-2)]">
          合作创作
        </span>
        {preview.map((member) => (
          <span key={`${member.mid ?? member.name}`} className="flex min-w-0 items-center gap-1">
            {member.roles.length > 0 ? (
              <span className="shrink-0 text-[var(--text-3)]">{member.roles.join('、')}</span>
            ) : null}
            <span className="truncate text-[var(--text-2)]">{member.name}</span>
          </span>
        ))}
        {rest > 0 || members.length > 1 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={toggle}
            className="t ml-auto flex shrink-0 items-center gap-0.5 text-[12px] text-[var(--accent)] hover:underline"
          >
            {expanded ? '收起' : `查看全部 ${members.length} 人`}
            <Icon
              name="chevronRight"
              size={12}
              className={expanded ? '-rotate-90' : 'rotate-90'}
            />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <ul className="mt-2 flex flex-col gap-1">
          {members.map((member) => {
            const row = (
              <>
                <Avatar src={member.face} alt={member.name} size={22} />
                <span className="min-w-0 flex-1 break-words text-[13px] text-[var(--text-1)]">
                  {member.name}
                </span>
                <span className="shrink-0 text-[12px] text-[var(--text-3)]">{member.roles.join('、')}</span>
              </>
            )
            return (
              <li key={`${member.mid ?? member.name}`} className="min-w-0">
                {member.mid !== null ? (
                  <button
                    type="button"
                    aria-label={`看 ${member.name} 的空间`}
                    title={`看 ${member.name} 的更多视频`}
                    onClick={() => open(member)}
                    className="t flex w-full min-w-0 items-center gap-2 rounded-[4px] px-1 py-1 text-left hover:bg-[var(--panel-raised)]"
                  >
                    {row}
                  </button>
                ) : (
                  <div className="flex min-w-0 items-center gap-2 px-1 py-1">{row}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
