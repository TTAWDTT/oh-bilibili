/** 评论里的一个可定位时间点。 */
export type CommentAnchor = {
  /** 在原文里的起点和终点；同一个分 P 标记会一起包进按钮。 */
  start: number
  end: number
  token: string
  /** 这个分 P 内的时间，毫秒。 */
  ms: number
  /** 明确指到的分 P；空表示这条没写明。 */
  page: number | null
  /** 写明的分 P 不存在或同一行自相矛盾时不给跳转，只保留原句。 */
  invalid: boolean
}

const TIME = /((?:\d{1,2}[:：])?[0-5]?\d[:：][0-5]\d)/g
const PAGE = /(?<=^|[\s（(【\[])[Pp](\d{1,3})(?=[\s:：,，、）)】\]]|$)/g

/**
 * 从一条评论里找时间点，并解析它指哪个分 P。
 *
 * 规则按 #263：同一行的「P2 03:20」优先；单独成行的「P2」约束它下面
 * 直到下一个分组标题的时间点；其余时间点不猜分 P，由调用方按当前 P 处理。
 * 同一行写了两个不同的 P、或 P 超出本稿分 P 数时标记为不可跳转。
 */
export function findCommentTimes(text: string, pages: number): CommentAnchor[] {
  const out: CommentAnchor[] = []
  let group: number | null = null
  let groupInvalid = false
  let offset = 0
  for (const line of text.split('\n')) {
    const header = line.match(/^\s*[Pp]\s*(\d{1,3})\s*[:：]?\s*$/)
    if (header) {
      const no = Number(header[1])
      groupInvalid = !(no >= 1 && no <= pages)
      group = groupInvalid ? null : no
      offset += line.length + 1
      continue
    }

    const markers = [...line.matchAll(PAGE)].map((m) => ({
      start: m.index ?? 0,
      page: Number(m[1]),
    }))
    /** 上一条时间的结尾：两条时间之间的 P 标记才算这一条的声明。 */
    let prevEnd = 0

    for (const time of line.matchAll(TIME)) {
      const token = time[1] ?? ''
      const ms = timestampMs(token)
      if (ms === null) continue
      const at = time.index ?? 0
      const claimed = markers.filter((m) => m.start >= prevEnd && m.start < at)
      const conflict = new Set(claimed.map((m) => m.page)).size > 1
      const marker = claimed.at(-1)
      let page: number | null = null
      let invalid = conflict
      let start = offset + at
      if (!conflict && marker) {
        const exists = marker.page >= 1 && marker.page <= pages
        page = exists ? marker.page : null
        invalid ||= !exists
        start = offset + marker.start
      } else if (!conflict) {
        page = group
        invalid ||= groupInvalid
      }
      out.push({ start, end: offset + at + token.length, token, ms, page: page ?? null, invalid })
      prevEnd = at + token.length
    }
    offset += line.length + 1
  }
  return out
}

/** `01:23` / `1:02:03` 转毫秒。全角冒号也认。 */
export function timestampMs(token: string): number | null {
  const parts = token.replace(/：/g, ':').split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 2) return ((parts[0] ?? 0) * 60 + (parts[1] ?? 0)) * 1000
  if (parts.length === 3) {
    return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * 1000
  }
  return null
}
