import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { PreciousView as PreciousData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { useAppStore } from '../../app/appStore'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { WideCard } from '../tracks/WideCard'
import { HotTabs } from './HotTabs'

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
      <HotTabs
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
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2">
            {data.items.map((item) => (
              <WideCard
                key={item.track.key}
                track={item.track}
                note={noteMap.get(item.track.key) ?? null}
                onOpen={() => navigate({ kind: 'watch', track: item.track }, undefined, `wide:${item.track.key}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
