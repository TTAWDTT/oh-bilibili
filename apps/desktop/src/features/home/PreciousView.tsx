import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { PreciousView as PreciousData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { HotPageHeader } from './HotPageHeader'
import { PreciousExhibit } from './PreciousExhibit'

/**
 * 入站必刷。B 站给新用户的首屏片单：一次返回全部条目，每条配一句官方推荐语。
 * 展墙按服务端顺序：每组一件宽展位加最多四件紧凑展位，只调整阅读节奏。
 */
export function PreciousView() {
  const [data, setData] = useState<PreciousData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    void ipc
      .precious()
      .then((view) => {
        if (!cancelled) setData(view)
      })
      .catch((cause) => {
        if (!cancelled) setError(toWireError(cause).message)
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  const toggleNote = (key: string): void => {
    setOpenNotes((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 每五件一组：第一件宽展位，其余四件紧凑。最后一组不足五件也按同一顺序排。
  const groups: PreciousData['items'][] = []
  for (const item of data?.items ?? []) {
    const last = groups.at(-1)
    if (!last || last.length >= 5) groups.push([item])
    else last.push(item)
  }

  return (
    <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto pb-10">
      <HotPageHeader
        active="precious"
        title={data?.title ?? '入站必刷'}
        extra={data ? String(data.items.length) : undefined}
      />
      <div className="px-4 md:px-8">
        {data === null ? (
          error ? (
            <EmptyState
              icon="alert"
              title="入站必刷没取到"
              detail={error}
              action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }}
            />
          ) : (
            <BiliLoader label="正在取片单…" />
          )
        ) : data.items.length === 0 ? (
          <EmptyState mascot="missYou" icon="biliTv" title="这个片单暂时是空的" action={null} />
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map((group, index) => (
              <section key={group[0]!.track.key} aria-label={`第 ${index + 1} 组`}>
                <PreciousExhibit
                  item={group[0]!}
                  hero
                  expanded={openNotes.has(group[0]!.track.key)}
                  onToggleNote={() => toggleNote(group[0]!.track.key)}
                />
                {group.length > 1 ? (
                  <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4">
                    {group.slice(1).map((item) => (
                      <PreciousExhibit
                        key={item.track.key}
                        item={item}
                        hero={false}
                        expanded={openNotes.has(item.track.key)}
                        onToggleNote={() => toggleNote(item.track.key)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
