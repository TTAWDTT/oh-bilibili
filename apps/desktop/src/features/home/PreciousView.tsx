import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { PreciousView as PreciousData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { useAppStore } from '../../app/appStore'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { WideCard } from '../tracks/WideCard'

/**
 * 入站必刷。B 站给新用户的首屏片单：一次返回全部条目，每条配一句官方推荐语。
 * 标题与标题下面那行文案都来自接口，不要改写成我们自己的说法。
 */
export function PreciousView() {
  const [data, setData] = useState<PreciousData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const navigate = useAppStore((state) => state.navigate)

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

  const noteMap = useMemo(
    () => new Map((data?.items ?? []).map((item) => [item.track.key, item.note])),
    [data],
  )

  return (
    <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto pb-10">
      {/* B 站入站必刷和热门共用同一条白色 header 带，正文也是同一种横排大卡；只有每张卡下面多一句官方推荐语。 */}
      <nav className="mb-4 bg-[var(--panel)] px-4 py-4 md:px-8">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[17px] font-medium text-[var(--text-1)]">{data?.title ?? '入站必刷'}</h2>
          {data ? <span className="num text-[12px] text-[var(--text-3)]">{data.items.length}</span> : null}
        </div>
        {data?.explain ? <p className="mt-1 text-[12px] text-[var(--text-3)]">{data.explain}</p> : null}
      </nav>
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
            <CardGridSkeleton cards={8} />
          )
        ) : data.items.length === 0 ? (
          <EmptyState mascot="missYou" icon="biliTv" title="这个片单暂时是空的" action={null} />
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2">
            {data.items.map((item) => (
              <WideCard
                key={item.track.key}
                track={item.track}
                note={noteMap.get(item.track.key) ?? null}
                onOpen={() => navigate({ kind: 'watch', track: item.track })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
