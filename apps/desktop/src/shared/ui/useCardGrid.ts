import { useCallback } from 'react'

/** 窗口和播放队列决定能排几列；收起左栏时，原来那几列一起变宽。 */
export function useCardGrid(minCardWidth: number) {
  return useCallback((grid: HTMLElement | null) => {
    if (!grid) return
    const workspace = grid.closest<HTMLElement>('.bili-workspace')!
    const sidebar = workspace.querySelector<HTMLElement>('.bili-sidebar')
    const updateColumns = () => {
      const style = getComputedStyle(grid)
      const gap = parseFloat(style.columnGap)
      const navWidth = sidebar?.getBoundingClientRect().width ?? 0
      const fullWidth = navWidth ? parseFloat(style.getPropertyValue('--sidebar-full')) : 0
      const limit = parseFloat(style.getPropertyValue('--page-max-width')) || Infinity
      const available = workspace.clientWidth
      const extra = Math.min(available - navWidth, limit) - Math.min(available - fullWidth, limit)

      // 空间正文和歌单网格各有独立的宽度上限，多出来的留白不参与列数计算。
      const width = Math.min(contentWidth(grid.parentElement!) - extra, parseFloat(style.maxWidth) || Infinity)
      const inner = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const columns = Math.max(1, Math.floor((inner + gap) / (minCardWidth + gap)))
      grid.style.setProperty('--card-tracks', `repeat(${columns}, minmax(0, 1fr))`)
    }
    updateColumns()
    const observer = new ResizeObserver(updateColumns)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [minCardWidth])
}

function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
}
