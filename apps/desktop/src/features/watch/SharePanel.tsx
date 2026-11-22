import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../shared/lib/contract'
import { copyText } from '../../shared/lib/clipboard'
import { formatTime } from '../../shared/lib/format'
import { readPlayhead } from '../../shared/lib/playhead'
import { toastFailure } from '../../app/notice'
import * as ipc from '../../shared/lib/ipc'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'
import { SHARE_ICONS } from './ShareIcons'
import { watchUrl } from './watchUrl'

const SOCIALS = ['动态', '微信', 'QQ', 'QQ空间', '微博', '贴吧', '嵌入代码'] as const
type Social = (typeof SOCIALS)[number]
type CopyKey = 'link' | 'dynamic' | 'embed'
type CopyState = 'idle' | 'done' | 'failed'

/**
 * B 站视频页的分享弹层：封面 + 分享链接、二维码，下面一排平台按钮。
 * 二维码用本地 qrcode 生成，链接和嵌入代码都从当前视频和分 P 算，不经过第三方。
 */
export function SharePanel({
  track,
  page,
  onClose,
}: {
  track: Track
  page: number
  onClose: () => void
}) {
  const [withTime, setWithTime] = useState(false)
  const [startAt] = useState(() => Math.max(0, Math.round(readPlayhead())))
  const [qr, setQr] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  /** 每个复制入口各自维护结果；连续点击以最后一次为准。 */
  const [copyState, setCopyState] = useState<Record<CopyKey, CopyState>>({
    link: 'idle',
    dynamic: 'idle',
    embed: 'idle',
  })
  const [hint, setHint] = useState<string | null>(null)
  const timers = useRef<Partial<Record<CopyKey, number>>>({})
  const seq = useRef<Record<CopyKey, number>>({ link: 0, dynamic: 0, embed: 0 })

  const baseUrl = watchUrl(track.key, page)
  const seconds = Math.floor(startAt / 1000)
  const shareUrl = withTime ? `${baseUrl}${page > 1 ? '&' : '?'}t=${seconds}` : baseUrl
  const embedCode = `<iframe src="//player.bilibili.com/player.html?isOutside=true&bvid=${track.key}&p=${page}${
    withTime ? `&t=${seconds}` : ''
  }" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`

  useEffect(() => {
    let cancelled = false
    setQr(null)
    setQrError(false)
    void ipc
      .qrSvg(shareUrl)
      .then((svg) => {
        if (!cancelled) setQr(svg)
      })
      .catch(() => {
        if (!cancelled) setQrError(true)
      })
    return () => {
      cancelled = true
    }
  }, [shareUrl])

  // 换分 P、改「从此刻开始」都会改链接：旧链接的反馈不能留在新链接上。
  useEffect(() => {
    setCopyState({ link: 'idle', dynamic: 'idle', embed: 'idle' })
    setHint(null)
    for (const timer of Object.values(timers.current)) {
      if (timer !== undefined) window.clearTimeout(timer)
    }
    timers.current = {}
    return () => {
      for (const timer of Object.values(timers.current)) {
        if (timer !== undefined) window.clearTimeout(timer)
      }
    }
  }, [shareUrl])

  const copy = (key: CopyKey, text: string): void => {
    const ticket = ++seq.current[key]
    const previous = timers.current[key]
    if (previous !== undefined) window.clearTimeout(previous)
    delete timers.current[key]
    setHint(null)
    void copyText(text).then((ok) => {
      if (seq.current[key] !== ticket) return
      setCopyState((state) => ({ ...state, [key]: ok ? 'done' : 'failed' }))
      if (!ok) return
      timers.current[key] = window.setTimeout(() => {
        if (seq.current[key] !== ticket) return
        setCopyState((state) => ({ ...state, [key]: 'idle' }))
      }, 1600)
    })
  }

  const open = (url: string): void => {
    void ipc.openExternal(url).catch((cause) => toastFailure('打开分享链接', cause))
  }

  const act = (label: Social): void => {
    const encoded = encodeURIComponent(shareUrl)
    const title = encodeURIComponent(track.title)
    switch (label) {
      case '动态':
        copy('dynamic', shareUrl)
        return
      case '微信':
        setHint('请用手机微信扫码，或把链接发给好友')
        return
      case 'QQ':
        open(`https://connect.qq.com/widget/shareqq/index.html?url=${encoded}&title=${title}`)
        return
      case 'QQ空间':
        open(`https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=${encoded}&title=${title}`)
        return
      case '微博':
        open(`https://service.weibo.com/share/share.php?url=${encoded}&title=${title}`)
        return
      case '贴吧':
        open(`https://tieba.baidu.com/f/commit/share/openShareApi?url=${encoded}&title=${title}`)
        return
      case '嵌入代码':
        setEmbedOpen((open) => !open)
        return
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-medium text-[var(--text-1)]">分享</h3>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="t flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--text-3)] hover:bg-[var(--panel-alt)] hover:text-[var(--text-1)]"
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      <div className="mt-3 flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="relative overflow-hidden rounded-[6px] bg-black">
            <Cover cover={track.cover} title={track.title} width={300} className="aspect-video w-full" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8">
              <p className="line-clamp-2 text-[12px] leading-[1.45] text-white">{track.title}</p>
            </div>
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
            <input
              type="checkbox"
              checked={withTime}
              onChange={(event) => setWithTime(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            从 <span className="num text-[var(--text-2)]">{formatTime(startAt)}</span> 开始分享
          </label>
          <button
            type="button"
            onClick={() => copy('link', shareUrl)}
            aria-live="polite"
            className={[
              't press mt-2 h-8 w-full rounded-[4px] text-[13px] text-white',
              copyState.link === 'failed'
                ? 'bg-[var(--danger)] hover:opacity-90'
                : copyState.link === 'done'
                  ? 'bg-[var(--accent)] opacity-90'
                  : 'bg-[var(--accent)] hover:opacity-90',
            ].join(' ')}
          >
            {copyState.link === 'done' ? '✓ 已复制' : copyState.link === 'failed' ? '复制失败，点此重试' : '获取视频分享链接'}
          </button>
        </div>

        <div className="flex w-[135px] shrink-0 flex-col items-center">
          <div className="flex h-[135px] w-[135px] items-center justify-center rounded-[4px] border border-[var(--line)] bg-white p-1.5 [&_svg]:h-full [&_svg]:w-full">
            {qr ? (
              <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            ) : qrError ? (
              <span className="text-center text-[11px] text-[var(--text-3)]">二维码生成失败</span>
            ) : (
              <BiliLoader compact label="" />
            )}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-[var(--text-3)]">手机扫码观看/分享</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 border-t border-hairline pt-3">
        {SOCIALS.map((label) => (
          <button
            key={label}
            type="button"
            title={label}
            onClick={() => act(label)}
            aria-live={label === '动态' ? 'polite' : undefined}
            className="t press flex w-11 flex-col items-center gap-1 whitespace-nowrap text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)]"
          >
            <span className="h-10 w-10" dangerouslySetInnerHTML={{ __html: SHARE_ICONS[label] ?? '' }} />
            {label === '动态' && copyState.dynamic === 'done'
              ? '已复制'
              : label === '动态' && copyState.dynamic === 'failed'
                ? '重试'
                : label}
          </button>
        ))}
      </div>
      {hint ? (
        <p role="status" className="mt-2 text-[12px] text-[var(--text-2)]">
          {hint}
        </p>
      ) : null}

      {embedOpen ? (
        <div className="mt-3 rounded-[6px] border border-[var(--line)] bg-[var(--ga0)] p-2">
          <p className="text-[11px] text-[var(--text-3)]">嵌入代码</p>
          <textarea
            readOnly
            value={embedCode}
            rows={3}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 w-full resize-none rounded-[4px] border border-[var(--line)] bg-[var(--panel)] p-2 font-mono text-[11px] leading-[1.5] text-[var(--text-2)] outline-none"
          />
          <button
            type="button"
            onClick={() => copy('embed', embedCode)}
            aria-live="polite"
            className={`t mt-1.5 h-7 rounded-[4px] px-3 text-[12px] text-white hover:opacity-90 ${
              copyState.embed === 'failed' ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]'
            }`}
          >
            {copyState.embed === 'done' ? '✓ 已复制' : copyState.embed === 'failed' ? '复制失败，点此重试' : '复制嵌入代码'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
