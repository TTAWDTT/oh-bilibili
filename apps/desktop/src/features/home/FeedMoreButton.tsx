import { useEffect, useRef } from 'react'

export function FeedMoreButton({ onMore }: { onMore: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const button = buttonRef.current
    if (!button) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onMore()
      },
      { root: button.closest('#scroll-main'), rootMargin: '180px 0px' },
    )
    observer.observe(button)
    return () => observer.disconnect()
  }, [onMore])

  return (
    <button type="button" ref={buttonRef} onClick={onMore}
      className="mx-auto mt-4 block rounded-md px-4 py-2 text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)]">
      加载更多
    </button>
  )
}
