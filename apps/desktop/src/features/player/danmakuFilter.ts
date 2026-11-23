import type { DanmakuItem } from './DanmakuField'
import type { DanmakuBlockType } from './danmakuSettings'

/** 一条弹幕落在哪一类；顶部 5、底部 4，其余都算滚动。 */
function kindOf(item: DanmakuItem): DanmakuBlockType {
  if (item.mode === 5) return 'top'
  if (item.mode === 4) return 'bottom'
  return 'roll'
}

/**
 * 画面上的弹幕只保留没被屏蔽的；右栏列表与热度仍用原记录。
 *
 * 屏蔽词按去掉首尾空格的子串匹配，大小写不敏感；空词忽略。
 * 听歌舞台与观看页共用这一份，避免两边规则各说各话。
 */
export function filterDanmaku(
  items: DanmakuItem[],
  blockWords: readonly string[],
  blockTypes: readonly DanmakuBlockType[],
): DanmakuItem[] {
  const words = blockWords.map((word) => word.trim().toLowerCase()).filter(Boolean)
  const types = new Set(blockTypes)
  if (words.length === 0 && types.size === 0) return items
  return items.filter((item) => {
    if (types.has(kindOf(item))) return false
    if (words.length === 0) return true
    const text = item.text.toLowerCase()
    return !words.some((word) => text.includes(word))
  })
}
