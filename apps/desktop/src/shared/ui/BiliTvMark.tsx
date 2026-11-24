type BiliTvMarkProps = { size?: number; alt?: string; className?: string | undefined }

export function BiliTvMark({ size = 24, alt = '', className }: BiliTvMarkProps) {
  return (
    <img
      src="/assets/illustrations/wink-tv.png"
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={className}
    />
  )
}
