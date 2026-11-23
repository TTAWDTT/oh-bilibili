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
