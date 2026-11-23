import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import { readPlayhead } from '../../shared/lib/playhead'
import { usePlayerStore } from './playerStore'
import { useDanmakuSettings } from './danmakuSettings'
import { useSentDanmaku } from './sentDanmaku'
import { DanmakuField, toDanmakuItems } from './DanmakuField'
import type { DanmakuItem } from './DanmakuField'
import { filterDanmaku } from './danmakuFilter'

const EMPTY: never[] = []

export function DanmakuLayer({ trackKey, fade = false }: { trackKey: string; fade?: boolean }) {
  const [items, setItems] = useState<DanmakuItem[]>([])
  const enabled = useDanmakuSettings((s) => s.enabled)
  const opacity = useDanmakuSettings((s) => s.opacity)
  const size = useDanmakuSettings((s) => s.size)
  const speed = useDanmakuSettings((s) => s.speed)
  const area = useDanmakuSettings((s) => s.area)
  const mergeSame = useDanmakuSettings((s) => s.mergeSame)
  const blockWords = useDanmakuSettings((s) => s.blockWords)
  const blockTypes = useDanmakuSettings((s) => s.blockTypes)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const sent = useSentDanmaku((s) => s.byTrack[trackKey] ?? EMPTY)

  useEffect(() => {
    let cancelled = false
    setItems([])
    void ipc
      .danmakuColored(trackKey)
      .then((list) => {
        if (!cancelled) setItems(toDanmakuItems(list))
      })
      .catch(() => setItems([]))
    return () => {
      cancelled = true
    }
  }, [trackKey])

  // 必须 memo：不 memo 的话每次渲染都是新数组，DanmakuField 里的定时器
  // 会被反复销毁重建，永远等不到第一次触发。
  const all = useMemo(
    () =>
      sent.length === 0
        ? items
        : [...items, ...sent.map((s) => ({ at: s.at, text: s.text, color: s.color, mode: 1 }))].sort(
            (a, b) => a.at - b.at,
          ),
    [items, sent],
  )
  /** 听歌舞台和观看页共用同一份屏蔽规则；热度与列表不受影响。 */
  const visible = useMemo(() => filterDanmaku(all, blockWords, blockTypes), [all, blockWords, blockTypes])
  const filterKey = `${blockWords.join('\u0000')}#${blockTypes.join(',')}`

  return (
    <DanmakuField
      items={visible}
      position={readPlayhead}
      playing={playing}
      enabled={enabled}
      opacity={opacity}
      size={size}
      speed={speed}
      area={area}
      fade={fade}
      mergeSame={mergeSame}
      resetToken={filterKey}
    />
  )
}
