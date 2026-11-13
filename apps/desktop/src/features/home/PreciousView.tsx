import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { PreciousView as PreciousData } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { PageTitle } from '../../shared/ui/PageTitle'
import { CardGridSkeleton } from '../../shared/ui/Skeleton'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'

/**
 * 入站必刷。B 站给新用户的首屏片单：一次返回全部条目，每条配一句官方推荐语。
 * 标题与标题下面那行文案都来自接口，不要改写成我们自己的说法。
 */
export function PreciousView() {
  const [data, setData] = useState<PreciousData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const snapshot = usePlayerStore((state) => state.snapshot)

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

  const tracks = useMemo(() => data?.items.map((item) => item.track) ?? [], [data])
  const noteMap = useMemo(
    () => new Map((data?.items ?? []).map((item) => [item.track.key, item.note])),
    [data],
  )

  return (
    <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8">
      <PageTitle extra={data ? String(data.items.length) : undefined}>
        {data?.title ?? '入站必刷'}
      </PageTitle>
      {data?.explain ? (
        <p className="mb-4 text-[13px] text-[var(--text-3)]">{data.explain}</p>
      ) : null}
      {data === null ? (
        error ? (
          <EmptyState
            icon="alert"
            title="入站必刷没取到"
            detail={error}
            action={{ label: '重试', onClick: () => setNonce((n) => n + 1) }}
          />
        ) : (
          <CardGridSkeleton cards={10} />
        )
      ) : data.items.length === 0 ? (
        <EmptyState icon="biliTv" title="这个片单暂时是空的" action={null} />
      ) : (
        <ContentGrid
          tracks={tracks}
          note={(track) => noteMap.get(track.key) ?? null}
          activeKey={snapshot?.track?.key ?? null}
          playing={snapshot?.phase === 'playing'}
        />
      )}
    </div>
  )
}
