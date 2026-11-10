import { useEffect, useState } from 'react'
import { readPlayhead } from './playhead'

/**
 * 按平滑播放位置算出「当前是第几行」，只在换行时触发重渲染。
 *
 * 原来直接订阅 snapshot.position_ms：后端每 200ms 推一次，整个歌词列表
 * 每秒重渲染 5 次，而真正变化的只有「当前行」这一个整数。
 */
export function useSmoothIndex(times: readonly number[], enabled: boolean): number {
  const [index, setIndex] = useState(-1)

  useEffect(() => {
    if (!enabled || times.length === 0) {
      setIndex(-1)
      return
    }
    let raf = 0
    let last = -2
    const tick = (): void => {
      const ms = readPlayhead()
      let idx = -1
      for (let i = 0; i < times.length; i += 1) {
        const at = times[i]
        if (at === undefined) break
        if (at <= ms) idx = i
        else break
      }
      if (idx !== last) {
        last = idx
        setIndex(idx)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [times, enabled])

  return index
}
