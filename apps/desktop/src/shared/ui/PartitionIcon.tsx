import { Icon } from './Icon'
import type { IconName } from './Icon'
/**
 * 分区彩色图标。B 站首页每个分区都有专属的彩色小图标，是它最好认的一处。
 *
 * 这里用色块 + 简单符号表达，不追求逐像素还原，但要一眼看出「这是分区图标」。
 */
type Kind = 'home' | 'watchLater' | 'music' | 'dance' | 'game' | 'anime' | 'life' | 'film' | 'history' | 'favs' | 'search' | 'settings'

/**
 * 底色沿用 B 站的品牌色，图形用图标组件里的 SVG 路径。
 *
 * 早先这里用的是 ♪ ♬ ◈ ✿ 这类 Unicode 字符——同一个符号在不同系统上字形不同，
 * 而且撑满色块时会显得像凑数。SVG 路径在任何设备上都一样。
 */
const STYLE: Record<Kind, { bg: string; icon: IconName }> = {
  home: { bg: '#fb7299', icon: 'biliTv' },
  watchLater: { bg: '#ffb027', icon: 'watchLater' },
  music: { bg: '#ff6699', icon: 'music' },
  dance: { bg: '#ff8fb3', icon: 'music' },
  game: { bg: '#53b6ff', icon: 'play' },
  anime: { bg: '#ffa3b6', icon: 'heart' },
  life: { bg: '#ffb027', icon: 'thumb' },
  film: { bg: '#ff8f9c', icon: 'play' },
  history: { bg: '#00AEEC', icon: 'clock' },
  favs: { bg: '#ffcf5b', icon: 'bookmarkStar' },
  search: { bg: '#fb7299', icon: 'search' },
  settings: { bg: '#9499a0', icon: 'settings' },
}

export function PartitionIcon({ kind, size = 18 }: { kind: Kind; size?: number }) {
  const style = STYLE[kind]
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-[4px] text-white"
      style={{ width: size, height: size, background: style.bg }}
    >
      <Icon name={style.icon} size={Math.round(size * 0.62)} />
    </span>
  )
}
