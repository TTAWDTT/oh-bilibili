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
  count: number
}

const PREFIX = 'oh-bilibili:season-of:'

export function rememberSeason(season: SeasonView | null | undefined): void {
  if (!season) return
  const keys = [...new Set(season.episodes.map((episode) => episode.key).filter(Boolean))]
  if (keys.length === 0) return
  const mark: SeasonMark = { id: season.id, title: season.title, count: keys.length }
  try {
    for (const key of keys) {
      localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(mark))
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
    const parsed = JSON.parse(raw) as Partial<SeasonMark> | null
    if (!parsed || typeof parsed.count !== 'number' || parsed.count < 1) return null
    return { id: Number(parsed.id ?? 0), title: String(parsed.title ?? '合集'), count: parsed.count }
  } catch {
    return null
  }
}

/** 书脊文案：有稿数写「合集 · N 稿」，只知道是合集才写「合集」。 */
export function seasonLabel(mark: SeasonMark | null): string | null {
  if (!mark) return null
  return mark.count > 0 ? `合集 · ${mark.count} 稿` : '合集'
}
