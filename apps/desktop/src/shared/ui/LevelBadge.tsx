/** 等级徽章配色：LV1 灰、LV2 绿、LV3 蓝、LV4 青、LV5 紫、LV6 红。 */
const COLORS = ['#9499a0', '#9499a0', '#7fa93b', '#3fa8d6', '#2fb3a8', '#a674d9', '#e23a5e']

export function LevelBadge({ level }: { level: number }) {
  if (level <= 0) return null
  return (
    <span
      className="shrink-0 rounded-[3px] px-1.5 text-[11.5px] font-semibold leading-[18px] text-white"
      style={{ background: COLORS[level] ?? COLORS[0] }}
      title={`LV${level}`}
    >
      LV{level}
    </span>
  )
}
