/** 书脊要写的内容：只有多 P 才写；有可靠断点就带上 P 号。 */
export function spineLabel(
  pages: number | null | undefined,
  resumePage: number | null | undefined,
): string | null {
  if (pages === null || pages === undefined || pages < 2) return null
  if (resumePage !== null && resumePage !== undefined && resumePage >= 1 && resumePage <= pages) {
    return `P${resumePage} / ${pages}`
  }
  return `${pages} P`
}

/** 读本稿上次看到的分 P；位置太靠前不算断点。 */
export function readResumePage(key: string): number | null {
  try {
    const page = Number(localStorage.getItem(`oh-bilibili:watch-page:${key}`))
    if (!Number.isInteger(page) || page <= 0) return null
    const at = Number(localStorage.getItem(`oh-bilibili:watch-pos:${key}:${page}`))
    return Number.isFinite(at) && at >= 5000 ? page : null
  } catch {
    return null
  }
}

export function rememberPageCount(key: string, count: number): void {
  try {
    if (count > 1) localStorage.setItem(`oh-bilibili:page-count:${key}`, String(count))
    else localStorage.removeItem(`oh-bilibili:page-count:${key}`)
  } catch {
    // 私密窗口可能禁用本地存储。
  }
}

export function knownPageCount(key: string, pages: number | null | undefined): number | null {
  if (pages && pages > 0) return pages
  try {
    const count = Number(localStorage.getItem(`oh-bilibili:page-count:${key}`))
    return Number.isSafeInteger(count) && count > 1 ? count : null
  } catch {
    return null
  }
}
