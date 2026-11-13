import { useState } from 'react'
import { Icon } from './Icon'
import { thumbUrl } from '../lib/thumb'

/**
 * 头像。加载失败或没有地址时退回人形图标。
 *
 * B 站的头像地址是 http 图床，webview 会按混合内容拦掉；后端已经升到 https，
 * 但链接失效（用户换头像）也会失败，所以这里必须有兜底。
 */
export function Avatar({
  src,
  alt,
  size = 24,
  bordered = true,
}: {
  src: string | null
  alt: string
  size?: number
  /** 大头像（账号卡）不要那圈细边，否则像贴了个便宜头像框。 */
  bordered?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed

  return (
    <span
      className={[
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full text-[var(--text-3)]',
        bordered ? 'border border-hairline' : '',
      ].join(' ')}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={thumbUrl(src, size * 2, size * 2) ?? src ?? ''}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : alt && alt !== '未登录' ? (
        <span className="text-[var(--text-2)]" style={{ fontSize: Math.round(size * 0.46) }}>
          {alt.slice(0, 1)}
        </span>
      ) : (
        <Icon name="user" size={Math.round(size * 0.55)} />
      )}
    </span>
  )
}
