import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type VirtualListProps<T> = {
  items: readonly T[]
  rowHeight: number
  renderRow: (item: T, index: number) => ReactNode
}

const OVERSCAN = 4

/**
 * 窗口化列表：只渲染可视区加两侧缓冲，上千行也不会把 DOM 撑爆。
 * 行高固定，滚动时只读事件上的 scrollTop，不在滚动路径里做任何布局读取。
 */
export function VirtualList<T>({ items, rowHeight, renderRow }: VirtualListProps<T>) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(0)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(() => setHeight(box.clientHeight))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const visible = Math.max(1, Math.ceil((height || rowHeight * 8) / rowHeight) + OVERSCAN * 2)
  const first = Math.min(offset, Math.max(0, items.length - visible))
  const slice = items.slice(first, first + visible)

  return (
    <div
      ref={boxRef}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        // 只有跨过整行才写状态，滚动期间绝大多数事件直接丢弃。
        const next = Math.max(0, Math.floor(event.currentTarget.scrollTop / rowHeight) - OVERSCAN)
        setOffset((current) => (next === current ? current : next))
      }}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${first * rowHeight}px)` }}>
          {slice.map((item, index) => (
            <div key={first + index} style={{ height: rowHeight }}>
              {renderRow(item, first + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
