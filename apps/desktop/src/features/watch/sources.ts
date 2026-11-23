/** 简介里能确认出处的素材/原作关系词。顺序从长到短，避免「动作数据」被拆成「动作」。 */
const RELATIONS = [
  '动作数据',
  '原舞',
  '原作',
  '原曲',
  '本家',
  '参考',
  '伴奏',
  '歌词',
  '模型',
  '动作',
  '素材',
  '下载',
  '出处',
] as const

const URL_RE = /https?:\/\/[^\s]+/g
const BV_RE = /\bBV[0-9A-Za-z]{10}\b/
const BARE_BV_RE = /\bBV[0-9A-Za-z]{10}\b/g

export type SourceEntry = {
  id: string
  /** 作者在这句话里用的关系词，按原文顺序。 */
  relations: string[]
  /** 作者原话（只取写明关系的那一行）。 */
  sentence: string
  kind: 'video' | 'external'
  /** 站内视频的 BV。 */
  bvid?: string
  /** 外部资源地址。 */
  url?: string
}

function cleanUrl(raw: string): string {
  return raw.replace(/[)。，、；：!?.,;:)\]】]+$/u, '')
}

/**
 * 同一行里的目标：完整链接，加上写在正文里的裸 BV 号（「原曲：BV1xx」很常见）。
 * 链接里带的 BV 已在 URL 里算过，先从正文里剔掉，免得一条算成两条。
 */
function linksIn(line: string): string[] {
  const urls = (line.match(URL_RE) ?? []).map(cleanUrl)
  const bare = [...line.replace(URL_RE, ' ').matchAll(BARE_BV_RE)].map((match) => match[0])
  const out: string[] = []
  const seen = new Set<string>()
  for (const link of [...urls, ...bare]) {
    const id = bvidOf(link) ?? link
    if (seen.has(id)) continue
    seen.add(id)
    out.push(link)
  }
  return out
}

function relationsIn(line: string): string[] {
  // 按原文出现顺序取词；正则按「长词在前」排列，所以「动作数据」不会再拆出「动作」。
  const pattern = new RegExp(RELATIONS.join('|'), 'g')
  return [...new Set([...line.matchAll(pattern)].map((match) => match[0]))]
}

function bvidOf(link: string): string | null {
  return link.match(BV_RE)?.[0] ?? null
}

/**
 * 只认投稿人自己在简介里写明的出处：
 * - 关系词与链接在同一行，或关系词下一行只放一个链接；
 * - 一行有多个链接时无法一一对应，整行跳过；
 * - 只有链接、没有关系词的行不当素材。
 */
export function parseSources(desc: string, currentKey: string): SourceEntry[] {
  const lines = desc.split(/\r?\n/)
  const entries: SourceEntry[] = []
  const seen = new Set<string>()

  const push = (sentence: string, relations: string[], link: string): void => {
    const bvid = bvidOf(link)
    if (bvid && bvid === currentKey) return
    const id = `${relations.join('|')}@${bvid ?? link}`
    if (seen.has(id)) return
    seen.add(id)
    entries.push({
      id,
      relations,
      sentence: sentence.trim(),
      kind: bvid ? 'video' : 'external',
      ...(bvid ? { bvid } : { url: link }),
    })
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim()
    if (!line) continue
    const relations = relationsIn(line)
    if (relations.length === 0) continue
    const links = [...new Set(linksIn(line))]
    if (links.length === 1) {
      push(line, relations, links[0]!)
      continue
    }
    if (links.length > 1) continue
    // 关系词一行、链接单独一行：只接受下一行除了一个链接没有别的正文。
    const next = (lines[i + 1] ?? '').trim()
    const nextLinks = [...new Set(linksIn(next))]
    const leftover = next.replace(URL_RE, ' ').replace(BARE_BV_RE, ' ').trim()
    if (nextLinks.length === 1 && leftover === '') {
      push(line, relations, nextLinks[0]!)
      i += 1
    }
  }
  return entries
}
