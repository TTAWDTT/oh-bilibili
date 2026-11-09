/**
 * 带头像框的头像。框是 B 站官方发布的 2233 娘头像框。
 *
 * 框图 420×420，中间镂空的圆在 x 176..288、y 181..291，
 * 所以头像要放在 41.9% / 43.1% 处，边长是框的 26.67%。
 * 这几个数是量出来的，不是猜的。
 */
export function FramedAvatar({
  src,
  alt,
  size = 112,
}: {
  src: string | null
  alt: string
  size?: number
}) {
  const inner = size * 0.2667
  return (
    <span
      className="relative inline-block shrink-0 select-none"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="absolute rounded-full object-cover"
          style={{
            left: size * 0.419,
            top: size * 0.431,
            width: inner,
            height: inner,
          }}
        />
      ) : (
        <span
          className="absolute rounded-full bg-[var(--panel-raised)]"
          style={{ left: size * 0.419, top: size * 0.431, width: inner, height: inner }}
        />
      )}
      <img
        src="/assets/2233-frame.png"
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      />
    </span>
  )
}
