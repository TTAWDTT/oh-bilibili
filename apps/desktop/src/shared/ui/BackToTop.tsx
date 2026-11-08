import { useEffect, useState } from 'react'
import { Icon } from './Icon'

/**
 * 回到顶部。滚动超过一屏才出现，B 站网页端右下角也是这个行为。
 *
 * 监听容器自己的 scroll 事件，而不是 window：内容区是独立滚动的。
 */
export function BackToTop({ targetId }: { targetId: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = document.getElementById(targetId)
    if (!el) return
    const onScroll = (): void => setShow(el.scrollTop > el.clientHeight)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [targetId])

  if (!show) return null

  return (
    <button
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      onClick={() => {
        document.getElementById(targetId)?.scrollTo({ top: 0, behavior: 'smooth' })
      }}
      className="t press fixed bottom-24 right-6 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-[var(--text-2)] shadow-md hover:text-[var(--accent)]"
    >
      <Icon name="chevronLeft" size={16} className="rotate-90" />
    </button>
  )
}
