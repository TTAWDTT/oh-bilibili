import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { Icon } from './Icon'

/**
 * 回到顶部。滚动超过一屏才出现，B 站网页端右下角也是这个行为。
 *
 * 监听容器自己的 scroll 事件，而不是 window：内容区是独立滚动的。
 */
export function BackToTop({ targetId }: { targetId: string }) {
  const [show, setShow] = useState(false)
  // 换页会换一个滚动容器；只在挂载时绑一次会绑到已卸载的节点上。
  const viewKind = useAppStore((state) => state.view.kind)

  useEffect(() => {
    setShow(false)
    const el = document.getElementById(targetId)
    if (!el) return
    const onScroll = (): void => setShow(el.scrollTop > el.clientHeight)
    el.addEventListener('scroll', onScroll, { passive: true })
    // 切页后新容器可能还没量出高度，挂载时先按当前滚动位置补一次
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [targetId, viewKind])

  if (!show) return null

  return (
    <button
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      onClick={() => {
        document.getElementById(targetId)?.scrollTo({ top: 0, behavior: 'smooth' })
      }}
      className="t press group fixed bottom-24 right-6 z-30 flex h-10 w-10 items-center overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] text-[var(--text-2)] shadow-md transition-[width,color,border-color]! duration-200! hover:w-[96px] hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:w-[96px] focus-visible:border-[var(--accent)] focus-visible:text-[var(--accent)] motion-reduce:transition-none!"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center">
        <Icon name="rocket" size={17} className="transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-focus-visible:-translate-y-0.5 motion-reduce:transition-none" />
      </span>
      <span className="shrink-0 whitespace-nowrap pr-3 text-[12px] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">回顶部</span>
    </button>
  )
}
