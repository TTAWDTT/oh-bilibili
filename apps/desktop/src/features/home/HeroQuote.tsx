import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { formatTime } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { Icon } from '../../shared/ui/Icon'
import { filterDanmaku } from '../player/danmakuFilter'
import { useDanmakuSettings } from '../player/danmakuSettings'

/** 引文取同一段 24 秒里最密的一小簇，读起来像同一刻的观众反应。 */
const QUOTE_WINDOW_S = 24

type Quote = { page: number; pages: number; atMs: number; text: string }

/** 同一句刷屏只计一次，取观众发言最集中的一段。 */
function pickQuote(
  lines: ipc.DanmakuLine[],
  page: number,
  pages: number,
): Quote | null {
  const seen = new Set<string>()
  const kept = lines
    .filter((line) => {
      const text = line.text.trim()
      if (!text || seen.has(text)) return false
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
    while (end < pool.length && pool[end]!.secs < pool[start]!.secs + QUOTE_WINDOW_S) end += 1
    if (end - start > bestCount) {
      bestCount = end - start
      bestStart = start
    }
  }
  const picked = pool[bestStart]!
  return {
    page,
    pages,
    atMs: Math.round(picked.secs * 1000),
    text: picked.text.trim(),
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
  const quoteKey = JSON.stringify([key, blockWords, blockTypes])
  const cache = useRef(new Map<string, Quote>())
  const [loaded, setLoaded] = useState<{ key: string; quote: Quote } | null>(null)

  useEffect(() => {
    if (!key || !enabled) return
    const cached = cache.current.get(quoteKey)
    if (cached) {
      setLoaded({ key: quoteKey, quote: cached })
      return
    }
    let alive = true
    void (async () => {
      try {
        const meta = await ipc.videoMeta(key)
        const page = meta.current_page || meta.pages[0]?.no || 1
        const cid = meta.pages.find((entry) => entry.no === page)?.cid
        if (!cid) return
        const lines = await ipc.danmakuColored(key, cid)
        const picked = pickQuote(filterDanmaku(lines, blockWords, blockTypes), page, meta.pages.length)
        if (!picked) return
        cache.current.set(quoteKey, picked)
        // 轮播可能已经翻走：旧稿的响应只进缓存，不进画面。
        if (alive) setLoaded({ key: quoteKey, quote: picked })
      } catch {
        // 取不到就维持普通首推，不做占位
      }
    })()
    return () => {
      alive = false
    }
  }, [key, enabled, blockWords, blockTypes, quoteKey])

  return enabled && loaded?.key === quoteKey ? loaded.quote : null
}

export function HeroQuoteLine({ track, quote, featured = false, onOpen }: {
  track: Track
  quote: Quote
  featured?: boolean
  onOpen: (track: Track, start: { page: number; atMs: number }) => void
}) {
  const time = `${quote.pages > 1 ? `P${quote.page} · ` : ''}${formatTime(quote.atMs)}`
  return (
    <button
      type="button"
      data-focus-id={`hero-quote:${track.key}`}
      aria-label={`从 ${time} 看弹幕：${quote.text}`}
      onClick={() => onOpen(track, { page: quote.page, atMs: quote.atMs })}
      className={`group mt-1 inline-flex max-w-full items-center gap-1.5 rounded py-1 text-left text-[var(--text-2)] hover:text-[var(--accent-strong)] ${featured ? 'text-[13px]' : 'text-[12px]'}`}
    >
      <Icon name="danmaku" size={14} className="shrink-0 text-[var(--text-3)]" />
      <span className="truncate">{quote.text}</span>
      <span className="num inline-flex shrink-0 items-center gap-0.5 text-[var(--accent-strong)]">
        {time}<Icon name="chevronRight" size={11} />
      </span>
    </button>
  )
}
