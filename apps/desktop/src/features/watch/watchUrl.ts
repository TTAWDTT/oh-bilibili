/** 当前分 P 的视频网址。P1 保持不带 p 的站内原形式。 */
export function watchUrl(key: string, page: number): string {
  return `https://www.bilibili.com/video/${key}${page > 1 ? `?p=${page}` : ''}`
}

export function parseWatchUrl(link: string): { bvid: string; page?: number; atMs?: number } | null {
  if (!URL.canParse(link)) return null
  const url = new URL(link)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(url.hostname)) return null
  const bvid = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1]
  if (!bvid) return null
  const page = Number(url.searchParams.get('p'))
  const seconds = Number(url.searchParams.get('t'))
  return {
    bvid,
    ...(Number.isSafeInteger(page) && page > 0 ? { page } : {}),
    ...(url.searchParams.has('t') && Number.isFinite(seconds) && seconds >= 0 ? { atMs: Math.round(seconds * 1000) } : {}),
  }
}
