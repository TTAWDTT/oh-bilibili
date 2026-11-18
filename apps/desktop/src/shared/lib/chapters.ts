/**
 * 从简介里抠出章节。
 *
 * B 站给 UGC 视频显示的「章节」就是简介里那些 `00:12 标题` 的行；
 * `x/player/wbi/v2` 的 `view_points` 只有 UP 主手动设过章节才有，绝大多数视频是空的。
 */
export type Chapter = { at: number; title: string }

/** `00:12` / `1:02:03` 转毫秒；不是时间就返回 null。 */
function stampMs(token: string): number | null {
  const parts = token.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 2) return ((parts[0] ?? 0) * 60 + (parts[1] ?? 0)) * 1000
  if (parts.length === 3) {
    return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * 1000
  }
  return null
}

/**
 * 只认「一行以时间开头」的行：正文里顺口提到的时间不该变成章节。
 * 同一个人时写两遍（常见于分P 简介）只留第一条。
 */
export function chaptersFrom(desc: string): Chapter[] {
  const out: Chapter[] = []
  const seen = new Set<number>()
  for (const line of desc.split('\n')) {
    const match = /^\s*[[(（【]?(\d{1,2}:\d{2}(?::\d{2})?)[\])）】]?[\s、.。,，:：\-—]*(.*)$/.exec(line)
    if (!match) continue
    const at = stampMs(match[1] ?? '')
    if (at === null || seen.has(at)) continue
    seen.add(at)
    out.push({ at, title: (match[2] ?? '').trim() })
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 40)
}
