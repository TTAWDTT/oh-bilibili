import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { readPlayhead } from '../../shared/lib/playhead'
import { usePlayerStore } from './playerStore'
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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const phase = usePlayerStore((s) => s.snapshot?.phase ?? 'idle')

  /**
   * 画面跟随音频引擎。
   *
   * <video> 自带音轨，而声音是由 Rust 引擎放的：两边各走一套时钟，
   * 一开 MV 就有两路声音、还对不上。所以视频静音，位置以引擎为准——
   * 落后或超前超过 400ms 就拉回来。Clock 是唯一的真值来源。
   */
  useEffect(() => {
    if (!mv || !src) return
    let raf = 0
    let last = 0
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      // 每 250ms 校一次，太频繁会打断解码
      if (now - last < 250) return
      last = now
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      if (Math.abs(video.currentTime * 1000 - readPlayhead()) > 400) {
        video.currentTime = readPlayhead() / 1000
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mv, src])

  // 播放/暂停跟随引擎
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (phase === 'playing') {
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [phase, src])

  useEffect(() => {
    if (!mv) {
      setSrc(null)
      setError(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        // mvSource 已经返回带句柄的本机地址，这里不要再拼端口或编码参数
        const url = await ipc.mvSource(mv.key)
        if (cancelled) return
        if (!url) {
          setError('浏览器预览模式没有本地代理，用桌面窗口才能看 MV。')
          return
        }
        setSrc(url)
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
    <div data-clickable
      role="dialog"
      aria-modal="true"
      aria-label="MV 播放"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
      onClick={() => setMv(null)}
    >
      <div data-clickable className="w-full max-w-[960px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="truncate text-[14px] text-[var(--text-1)]" title={mv.title}>
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
          <div className="flex h-[300px] items-center justify-center border border-hairline text-[14px] text-white/60">
            {error}
          </div>
        ) : src ? (
          <video
            ref={videoRef}
            src={src}
            controls
            autoPlay
            muted
            playsInline
            className="w-full rounded-[4px] bg-black"
            style={{ maxHeight: '70vh' }}
            onError={() => setError('视频加载失败，可能是直链已过期，重新打开一次。')}
          />
        ) : (
          <div className="flex h-[300px] items-center justify-center border border-hairline text-[14px] text-[var(--text-3)]">
            正在取流…
          </div>
        )}
      </div>
    </div>
  )
}
