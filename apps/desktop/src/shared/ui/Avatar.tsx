import { useState } from 'react'
import { Icon } from './Icon'

/**
 * 头像。加载失败或没有地址时退回人形图标。
 *
 * B 站的头像地址是 http 图床，webview 会按混合内容拦掉；后端已经升到 https，
 * 但链接失效（用户换头像）也会失败，所以这里必须有兜底。
 */
export function Avatar({ src, alt, size = 24 }: { src: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-hairline text-[var(--text-3)]"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={src ?? ''}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="user" size={Math.round(size * 0.55)} />
      )}
    </span>
  )
}
