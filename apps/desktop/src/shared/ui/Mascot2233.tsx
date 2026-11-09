/**
 * 22 娘与 33 娘。B 站官方站娘形象，用官方原图，不自己画。
 *
 * 图已去白底（public/assets/2233.png），所以在任何浅色背景上都能直接用。
 * `height` 控制显示高度，宽度按原图比例（316:568）自动。
 */
export function Mascot2233({
  height = 200,
  className = '',
}: {
  height?: number
  className?: string
}) {
  const width = Math.round((height * 316) / 568)
  return (
    <img
      src="/assets/2233.png"
      alt=""
      aria-hidden
      width={width}
      height={height}
      style={{ height, width }}
      className={`select-none object-contain ${className}`}
    />
  )
}
