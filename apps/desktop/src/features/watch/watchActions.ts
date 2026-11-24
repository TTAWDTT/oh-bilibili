/**
 * 观看页自己的动作，给全局快捷键用。
 *
 * 快捷键挂在 window 上，收藏却要按当前页面选中的收藏夹走，所以这里只留一个
 * 入口：页面挂载时把自己的处理函数放进来，卸载时拿走。
 */
let favHandler: (() => void) | null = null

export function setWatchFavHandler(next: (() => void) | null): void {
  favHandler = next
}

export function watchFav(): void {
  favHandler?.()
}

type WatchSeek = (atMs: number, page: number) => void
let seekHandler: WatchSeek | null = null

export function setWatchSeekHandler(next: WatchSeek | null): void {
  seekHandler = next
}

export function seekCurrentWatch(atMs: number, page: number): void {
  seekHandler?.(atMs, page)
}
