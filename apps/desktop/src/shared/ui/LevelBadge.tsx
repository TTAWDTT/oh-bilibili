/**
 * 等级徽章配色，直接取 B 站官方等级图集 `level.png` 的底色：
 * LV0/1 灰、LV2 薄荷绿、LV3 浅蓝、LV4 蜜桃橙、LV5 橙、LV6 红、LV7 品红、LV8 紫、LV9 黑。
 */
const COLORS = [
  '#bfbfbf',
  '#bfbfbf',
  '#95ddb2',
  '#92d1e5',
  '#ffb37c',
  '#ff6c00',
  '#ff0000',
  '#e52fec',
  '#841cf9',
  '#151515',
]

export function LevelBadge({ level }: { level: number }) {
  if (level <= 0) return null
  return (
    <span
      className="shrink-0 rounded-[3px] px-1.5 text-[11.5px] font-semibold leading-[18px] text-white"
      style={{ background: COLORS[level] ?? COLORS[0], textShadow: '0 1px 1px rgb(0 0 0 / 0.2)' }}
      title={`LV${level}`}
    >
      LV{level}
    </span>
  )
}
