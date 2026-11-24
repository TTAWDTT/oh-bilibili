import type { DanmakuBlockType } from './danmakuSettings'

/** 一条弹幕落在哪一类；顶部 5、底部 4，其余都算滚动。 */
function kindOf(mode: number): DanmakuBlockType {
  if (mode === 5) return 'top'
  if (mode === 4) return 'bottom'
  return 'roll'
}

/**
 * 画面上的弹幕只保留没被屏蔽的；右栏列表与热度仍用原记录。
 *
 * 屏蔽词按去掉首尾空格的子串匹配，大小写不敏感；空词忽略。
 */
export function filterDanmaku<T extends { mode: number; text: string }>(
  items: T[],
  blockWords: readonly string[],
  blockTypes: readonly DanmakuBlockType[],
): T[] {
  const words = blockWords.map((word) => word.trim().toLowerCase()).filter(Boolean)
  const types = new Set(blockTypes)
  if (words.length === 0 && types.size === 0) return items
  return items.filter((item) => {
    if (types.has(kindOf(item.mode))) return false
    if (words.length === 0) return true
    const text = item.text.toLowerCase()
    return !words.some((word) => text.includes(word))
  })
}
