/** 当前分 P 的视频网址。P1 保持不带 p 的站内原形式。 */
export function watchUrl(key: string, page: number): string {
  return `https://www.bilibili.com/video/${key}${page > 1 ? `?p=${page}` : ''}`
}
