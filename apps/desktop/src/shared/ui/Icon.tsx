import type { ReactNode } from 'react'

const ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4.2 4.2" />
    </>
  ),
  library: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  heart: <path d="M12 20s-7.2-4.4-7.2-9.1A4 4 0 0 1 12 8.4a4 4 0 0 1 7.2 2.5C19.2 15.6 12 20 12 20Z" />,
  heartFilled: (
    <path
      d="M12 20s-7.2-4.4-7.2-9.1A4 4 0 0 1 12 8.4a4 4 0 0 1 7.2 2.5C19.2 15.6 12 20 12 20Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  bookmark: <path d="M7 4.8h10a1.2 1.2 0 0 1 1.2 1.2v14l-6.2-4.2L5.8 20V6A1.2 1.2 0 0 1 7 4.8Z" />,
  bookmarkFilled: (
    <path
      d="M7 4.8h10a1.2 1.2 0 0 1 1.2 1.2v14l-6.2-4.2L5.8 20V6A1.2 1.2 0 0 1 7 4.8Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10.6 4 3.8 4-3.8" />
      <path d="M5 19h14" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.4l3 1.8" />
    </>
  ),
  play: <path d="M9 6.4v11.2L18.5 12 9 6.4Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="8" y="6" width="2.8" height="12" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.2" y="6" width="2.8" height="12" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  prev: (
    <>
      <path d="M18.5 6v12" />
      <path d="M15.5 12 7 6.4v11.2L15.5 12Z" fill="currentColor" stroke="none" />
    </>
  ),
  next: (
    <>
      <path d="M5.5 6v12" />
      <path d="M8.5 12 17 6.4v11.2L8.5 12Z" fill="currentColor" stroke="none" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4 7h3.2l3 5" />
      <path d="M4 17h3.2l9-10H20" />
      <path d="m17.4 4.6 2.6 2.4-2.6 2.4" />
      <path d="m17.4 14.6 2.6 2.4-2.6 2.4" />
    </>
  ),
  repeat: (
    <>
      <path d="M6 9V8a3 3 0 0 1 3-3h9" />
      <path d="m15.6 2.6 2.6 2.4-2.6 2.4" />
      <path d="M18 15v1a3 3 0 0 1-3 3H6" />
      <path d="m8.4 21.4-2.6-2.4 2.6-2.4" />
    </>
  ),
  repeatOne: (
    <>
      <path d="M6 9V8a3 3 0 0 1 3-3h9" />
      <path d="m15.6 2.6 2.6 2.4-2.6 2.4" />
      <path d="M18 15v1a3 3 0 0 1-3 3H6" />
      <path d="m8.4 21.4-2.6-2.4 2.6-2.4" />
      <path d="M11 10.2 12.2 9.4v5.2" />
    </>
  ),
  volume: (
    <>
      <path d="M5 10v4h3l4 3.4V6.6L8 10H5Z" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6" />
    </>
  ),
  mute: (
    <>
      <path d="M5 10v4h3l4 3.4V6.6L8 10H5Z" />
      <path d="m16 10 4 4M20 10l-4 4" />
    </>
  ),
  lyrics: (
    <>
      <path d="M5 7h9M5 12h13M5 17h7" />
      <circle cx="18" cy="16.5" r="1.6" />
    </>
  ),
  queue: (
    <>
      <path d="M5 7h10M5 12h10M5 17h6" />
      <path d="m16.8 10.4 4 2.6-4 2.6V10.4Z" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5.5 12.5 4.2 4.2L18.5 8" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M20 4.2v4.6h-4.6" />
    </>
  ),
  settings: (
    <>
      <path d="M5 8h14M5 16h14" />
      <circle cx="9.5" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="16" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M5.2 20c.8-4 3.4-5.8 6.8-5.8s6 1.8 6.8 5.8" />
    </>
  ),
  logout: (
    <>
      <path d="M14 5.5H7.5A1.5 1.5 0 0 0 6 7v10a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M12.5 12h8M17.5 8.8 20.8 12l-3.3 3.2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6v5.2" />
      <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5.2" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="10" height="11" rx="2" />
      <path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  music: (
    <>
      <path d="M9.5 18V6.8l9-2v11" />
      <circle cx="7" cy="18" r="2.3" />
      <circle cx="16.5" cy="15.8" r="2.3" />
    </>
  ),
  sync: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3l2.2 2.1" />
      <path d="M19.5 4.4v4.4H15" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3l-2.2-2.1" />
      <path d="M4.5 19.6v-4.4H9" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}
