import { formatTime } from '../../shared/lib/format.ts'

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

export type NotePage = { no: number; duration_ms: number }

const TOKENS = /https?:\/\/[^\s，。；、）】]+|(?:\d{1,2}[:：])?[0-5]?\d[:：][0-5]\d/g
const PAGE = /(^|[^\p{L}\p{N}_])[Pp](\d{1,3})(?=[\s:：,，、）)】\]]|$)/gu

export function findCommentTimes(text: string, pages: readonly NotePage[], trackKey?: string): CommentAnchor[] {
  const out: CommentAnchor[] = []
  let group: number | null = null
  let offset = 0
  for (const line of text.split('\n')) {
    const header = line.match(/^\s*[Pp]\s*(\d{1,3})\s*[:：]?\s*$/)
    if (header) {
      group = Number(header[1])
    } else {
      let previousEnd = 0
      for (const match of line.matchAll(TOKENS)) {
        const tokenStart = match.index
        const raw = match[0]
        const isLink = raw.startsWith('http')
        const token = isLink ? raw.replace(/[.,;:!?)\]]+$/, '') : raw
        const declaration = line.slice(previousEnd, tokenStart)
        const claims = [...declaration.matchAll(PAGE)]
        previousEnd = tokenStart + raw.length
        const link = isLink ? linkedTime(token, trackKey) : null
        if (isLink && !link) continue
        const ms = link?.ms ?? timestampMs(token)
        if (ms === null) continue
        const marker = claims.at(-1)
        const claimed = claims.map((m) => Number(m[2]))
        if (link) claimed.push(link.page)
        const pageNo = claimed.at(-1) ?? group ?? (pages.length === 1 ? pages[0]!.no : null)
        const page = pages.find((entry) => entry.no === pageNo)
        const invalid = pages.length === 0 || new Set(claimed).size > 1 || (pageNo !== null && (!page || ms > page.duration_ms))
        const start = !marker ? tokenStart : tokenStart - declaration.length + marker.index + (marker[1] ?? '').length
        out.push({
          start: offset + start,
          end: offset + tokenStart + token.length,
          token: link ? formatTime(ms) : token,
          ms,
          page: page?.no ?? null,
          invalid,
        })
      }
    }
    offset += line.length + 1
  }
  return out
}

function linkedTime(raw: string, trackKey?: string): { page: number; ms: number } | null {
  const url = URL.canParse(raw) ? new URL(raw) : null
  if (!url || !['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(url.hostname)) return null
  const video = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)\/?$/)?.[1]
  const time = url.searchParams.get('t')
  const page = url.searchParams.get('p') ?? '1'
  if (!video || video !== trackKey || !time || !/^\d+(?:\.\d+)?$/.test(time) || !/^\d+$/.test(page)) return null
  return { page: Number(page), ms: Math.round(Number(time) * 1000) }
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
