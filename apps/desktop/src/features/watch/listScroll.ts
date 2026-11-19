/** 只滚列表自身，`scrollIntoView` 会连观看页的整页滚动容器一起滚。 */
export function scrollIntoList(item: HTMLElement | null, list: HTMLElement | null): void {
  if (!item || !list) return
  const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
  const bottom = top + item.offsetHeight
  if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight
  }
}
