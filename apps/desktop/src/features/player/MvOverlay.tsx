import { useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { toWireError } from '../../shared/lib/errors'
import * as ipc from '../../shared/lib/ipc'
import { Icon } from '../../shared/ui/Icon'

/**
 * MV 浮层。
 *
 * 视频字节必须经本地代理转发：B 站视频 CDN 只认 bilibili 的 Referer，
 * 而页面里的 <video> 改不了请求头。代理端口由 Rust 侧启动时随机分配。
 */
export function MvOverlay() {
  const mv = useAppStore((state) => state.mv)
  const setMv = useAppStore((state) => state.setMv)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mv) {
      setSrc(null)
      setError(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [port, direct] = await Promise.all([ipc.mvPort(), ipc.mvSource(mv.key)])
        if (cancelled) return
        if (!port) {
          setError('浏览器预览模式没有本地代理，用桌面窗口才能看 MV。')
          return
        }
        setSrc(`http://127.0.0.1:${port}/p?u=${encodeURIComponent(direct)}`)
      } catch (e) {
        if (!cancelled) setError(toWireError(e).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mv])

  useEffect(() => {
    if (!mv) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMv(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mv, setMv])

  if (!mv) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="MV 播放"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
      onClick={() => setMv(null)}
    >
      <div className="w-full max-w-[960px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="truncate text-[13px] text-white/80" title={mv.title}>
            {mv.title}
          </span>
          <button
            type="button"
            onClick={() => setMv(null)}
            aria-label="关闭"
            className="t press flex h-6 w-6 items-center justify-center rounded-[4px] text-white/60 hover:text-white"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        {error ? (
          <div className="flex h-[300px] items-center justify-center border border-hairline text-[13px] text-white/60">
            {error}
          </div>
        ) : src ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="w-full rounded-[4px] bg-black"
            style={{ maxHeight: '70vh' }}
            onError={() => setError('视频加载失败，可能是直链已过期，重新打开一次。')}
          />
        ) : (
          <div className="flex h-[300px] items-center justify-center border border-hairline text-[13px] text-white/40">
            正在取流…
          </div>
        )}
      </div>
    </div>
  )
}
