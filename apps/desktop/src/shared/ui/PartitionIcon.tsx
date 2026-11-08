/**
 * 分区彩色图标。B 站首页每个分区都有专属的彩色小图标，是它最好认的一处。
 *
 * 这里用色块 + 简单符号表达，不追求逐像素还原，但要一眼看出「这是分区图标」。
 */
type Kind = 'music' | 'dance' | 'game' | 'anime' | 'life' | 'film' | 'history' | 'favs' | 'search' | 'settings'

const STYLE: Record<Kind, { bg: string; mark: string }> = {
  music: { bg: '#ff6699', mark: '♪' },
  dance: { bg: '#ff8fb3', mark: '♬' },
  game: { bg: '#53b6ff', mark: '◈' },
  anime: { bg: '#ffa3b6', mark: '✿' },
  life: { bg: '#ffb027', mark: '☀' },
  film: { bg: '#ff8f9c', mark: '▶' },
  history: { bg: '#00AEEC', mark: '↻' },
  favs: { bg: '#ffcf5b', mark: '★' },
  search: { bg: '#fb7299', mark: '⌕' },
  settings: { bg: '#9499a0', mark: '⚙' },
}

export function PartitionIcon({ kind, size = 18 }: { kind: Kind; size?: number }) {
  const style = STYLE[kind]
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-[4px] text-white"
      style={{
        width: size,
        height: size,
        background: style.bg,
        fontSize: Math.round(size * 0.62),
        lineHeight: 1,
      }}
    >
      {style.mark}
    </span>
  )
}
