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

export function DanmakuLayer({ trackKey, page }: { trackKey: string; page: PageRef | null }) {
  const [items, setItems] = useState<DanmakuItem[]>([])
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const size = useDanmakuSettings((s) => s.size)
  const speed = useDanmakuSettings((s) => s.speed)
  const mergeSame = useDanmakuSettings((s) => s.mergeSame)
  const blockWords = useDanmakuSettings((s) => s.blockWords)
  const blockTypes = useDanmakuSettings((s) => s.blockTypes)
  const playbackRate = usePlayerStore((s) => s.snapshot?.speed ?? 1)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const cid = page?.cid
  const key = danmakuPartKey(trackKey, page?.no)
  const sent = useSentDanmaku((s) => s.byTrack[key] ?? EMPTY)

  useEffect(() => {
    let cancelled = false
    setItems([])
    void ipc
      .danmakuColored(trackKey, cid)
      .then((list) => {
        if (!cancelled) setItems(toDanmakuItems(list))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [trackKey, cid])

  // 必须 memo：不 memo 的话每次渲染都是新数组，DanmakuField 里的定时器
  // 会被反复销毁重建，永远等不到第一次触发。
  const all = useMemo(
    () => withLocalEchoes(items, sent.map((s) => ({ ...s, mode: 1, own: true }))),
    [items, sent],
  )
  /** 听歌舞台和观看页共用同一份屏蔽规则；热度与列表不受影响。 */
  const visible = useMemo(() => filterDanmaku(all, blockWords, blockTypes), [all, blockWords, blockTypes])

  return (
    <DanmakuField
      items={visible}
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
