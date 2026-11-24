import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { readPlayhead } from '../../shared/lib/playhead'
import { usePlayerStore } from './playerStore'
import { useDanmakuSettings } from './danmakuSettings'
import { danmakuPartKey, useSentDanmaku } from './sentDanmaku'
import { DanmakuField, toDanmakuItems } from './DanmakuField'
import type { PageRef } from '../../shared/lib/contract'
import type { DanmakuItem } from './DanmakuField'
import { filterDanmaku } from './danmakuFilter'
import { withLocalEchoes } from './danmakuMerge'

const EMPTY: never[] = []

export function useStageDanmaku(trackKey: string | undefined, page: PageRef | null) {
  const [loaded, setLoaded] = useState<{
    trackKey: string
    cid: number | undefined
    items: DanmakuItem[]
  } | null>(null)
  const enabled = useDanmakuSettings((s) => s.enabled)
  const blockWords = useDanmakuSettings((s) => s.blockWords)
  const blockTypes = useDanmakuSettings((s) => s.blockTypes)
  const cid = page?.cid
  const key = trackKey ? danmakuPartKey(trackKey, page?.no) : ''
  const sent = useSentDanmaku((s) => s.byTrack[key] ?? EMPTY)

  useEffect(() => {
    if (!enabled || !trackKey) return
    let cancelled = false
    void ipc.danmakuColored(trackKey, cid)
      .then((list) => {
        if (!cancelled) setLoaded({ trackKey, cid, items: toDanmakuItems(list, 'var(--text-1)') })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [trackKey, cid, enabled])

  const items = loaded && loaded.trackKey === trackKey && loaded.cid === cid ? loaded.items : EMPTY
  return useMemo(() => {
    if (!enabled || !trackKey) return EMPTY
    const all = withLocalEchoes(items, sent.map((s) => ({ ...s, mode: 1, own: true })))
    return filterDanmaku(all, blockWords, blockTypes)
  }, [enabled, trackKey, items, sent, blockWords, blockTypes])
}

export function DanmakuLayer({ items }: { items: DanmakuItem[] }) {
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const size = useDanmakuSettings((s) => s.size)
  const speed = useDanmakuSettings((s) => s.speed)
  const mergeSame = useDanmakuSettings((s) => s.mergeSame)
  const playbackRate = usePlayerStore((s) => s.snapshot?.speed ?? 1)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')

  return (
    <DanmakuField
      items={items}
      position={readPlayhead}
      playing={playing}
      enabled={enabled}
      opacity={opacity}
      size={size}
      speed={speed}
      singleLine
      mergeSame={mergeSame}
      playbackRate={playbackRate}
    />
  )
}
