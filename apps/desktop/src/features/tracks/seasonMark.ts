import type { SeasonView } from '../../shared/lib/contract'

/**
 * 合集标记：某一稿属于哪个合集、这个合集一共几稿。
 *
 * 列表接口不带 `ugc_season`，逐稿请求详情又是一屏几十个请求。
 * 所以在已经打开过观看页（详情本来就要取）时把合集记到本地，
 * 之后列表里的同一稿直接用这份标记，不额外发请求。
 * 只记有完整目录的合集：稿数必须来自真实条目，不能猜。
 */
export type SeasonMark = {
  id: number
  title: string
  /** 合集里的独立稿件数。同一 BV 的多个分 P 不重复计数。 */
  count: number | null
}

const PREFIX = 'oh-bilibili:season-of:'

export function rememberSeason(season: SeasonView | null | undefined, currentKey?: string): void {
  if (!season) return
  const keys = [...new Set(season.episodes.map((episode) => episode.key).filter(Boolean))]
  // 打开的那一稿本身也算：有的接口只在目录里给别的集，
  // 或者当前这集被折叠在别的 section 里，漏掉它等于这张卡永远没有入口。
  if (currentKey && !keys.includes(currentKey)) keys.push(currentKey)
  if (keys.length === 0) return
  const mark: SeasonMark = { id: season.id, title: season.title, count: season.work_count ?? null }
  try {
    for (const key of keys) {
      localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ id: mark.id, title: mark.title, workCount: mark.count }))
    }
  } catch {
    // 隐私模式写不进去：只是少了书脊，不影响观看
  }
}

export function readSeasonMark(key: string | undefined): SeasonMark | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Number.isSafeInteger(parsed?.id) || typeof parsed.title !== 'string') return null
    // 旧版本的 count 来自已加载目录，不能证明合集总稿数。
    const count = Number.isSafeInteger(parsed.workCount) && parsed.workCount > 0 ? parsed.workCount : null
    return { id: parsed.id, title: parsed.title, count }
  } catch {
    return null
  }
}

/** 书脊文案：有稿数写「合集 · N 稿」，只知道是合集才写「合集」。 */
export function seasonLabel(mark: SeasonMark | null): string | null {
  if (!mark) return null
  return mark.count !== null && mark.count > 0 ? `合集 · ${mark.count} 稿` : '合集'
}
