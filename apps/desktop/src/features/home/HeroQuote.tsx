import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { formatTime } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { useDanmakuSettings } from '../player/danmakuSettings'

/** 引文取同一段 24 秒里最密的一小簇，读起来像同一刻的观众反应。 */
const QUOTE_WINDOW_S = 24

export type Quote = { page: number; pages: number; cid: number; at: number; lines: string[] }

/** 按用户的屏蔽词与屏蔽类型过滤，再去重、取最密的一段，最多三条。 */
function pickQuote(
  lines: ipc.DanmakuLine[],
  page: number,
  pages: number,
  cid: number,
  blockWords: string[],
  blockTypes: string[],
): Quote | null {
  const words = blockWords.map((word) => word.toLowerCase())
  const seen = new Set<string>()
  const kept = lines
    .filter((line) => line.text.trim().length > 0)
    .filter((line) => {
      if (line.mode === 1 && blockTypes.includes('roll')) return false
      if (line.mode === 5 && blockTypes.includes('top')) return false
      if (line.mode === 4 && blockTypes.includes('bottom')) return false
      const text = line.text.trim()
      if (words.some((word) => text.toLowerCase().includes(word))) return false
      if (seen.has(text)) return false
      seen.add(text)
      return true
    })
    .sort((a, b) => a.secs - b.secs)
  if (kept.length === 0) return null

  // 开场几秒多是「第一」「空降」这类报幕，往后挪一点更像一条能读的观众反应。
  const opening = kept.findIndex((line) => line.secs >= 5)
  const pool = opening > 0 ? kept.slice(opening) : kept

  let bestStart = 0
  let bestCount = 0
  for (let start = 0, end = 0; start < pool.length; start += 1) {
    if (end < start) end = start
    while (end < pool.length && pool[end]!.secs < pool[start]!.secs + QUOTE_WINDOW_S) end += 1
    if (end - start > bestCount) {
      bestCount = end - start
      bestStart = start
    }
  }
  const picked = pool.slice(bestStart, bestStart + Math.min(3, bestCount))
  return {
    page,
    pages,
    cid,
    at: Math.floor(picked[0]!.secs),
    lines: picked.map((line) => line.text.trim()),
  }
}

/**
 * 只为当前首推取同一分 P 的真实弹幕。
 *
 * 先取详情拿默认页的 cid，再取那一页的弹幕；结果按稿件缓存，轮播翻回来不再请求。
 * 未露出的推荐不请求，关掉弹幕时整块消失。
 */
export function useHeroQuote(key: string | undefined): Quote | null {
  const enabled = useDanmakuSettings((state) => state.enabled)
  const blockWords = useDanmakuSettings((state) => state.blockWords)
  const blockTypes = useDanmakuSettings((state) => state.blockTypes)
  const cache = useRef(new Map<string, Quote>())
  const [quote, setQuote] = useState<Quote | null>(null)

  useEffect(() => {
    if (!key || !enabled) {
      setQuote(null)
      return
    }
    const cached = cache.current.get(key)
    if (cached) {
      setQuote(cached)
      return
    }
    let alive = true
    setQuote(null)
    void (async () => {
      try {
        const meta = await ipc.videoMeta(key)
        const page = meta.current_page || meta.pages[0]?.no || 1
        const cid = meta.pages.find((entry) => entry.no === page)?.cid
        if (!cid) return
        const picked = pickQuote(
          await ipc.danmakuColored(key, cid),
          page,
          meta.pages.length,
          cid,
          blockWords,
          blockTypes,
        )
        if (!picked) return
        cache.current.set(key, picked)
        // 轮播可能已经翻走：旧稿的响应只进缓存，不进画面。
        if (alive) setQuote(picked)
      } catch {
        // 取不到就维持普通首推，不做占位
      }
    })()
    return () => {
      alive = false
    }
  }, [key, enabled, blockWords, blockTypes])

  return quote
}

export function quoteLabel(quote: Quote): string {
  return `从 ${quote.pages > 1 ? `P${quote.page} · ` : ''}${formatTime(quote.at * 1000)} 看`
}

/** 窄窗与右侧小卡共用的一行引文：一句原话 + 明确的时间入口。 */
export function HeroQuoteLine({
  track,
  quote,
  onOpen,
}: {
  track: Track
  quote: Quote
  onOpen: (track: Track, start: { page: number; atMs: number }) => void
}) {
  return (
    <div className="mt-2 flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-2)]">{quote.lines[0]}</span>
      <button
        type="button"
        onClick={() => onOpen(track, { page: quote.page, atMs: quote.at * 1000 })}
        className="t press shrink-0 text-[12px] text-[var(--accent)] hover:underline"
      >
        {quoteLabel(quote)}
      </button>
    </div>
  )
}
