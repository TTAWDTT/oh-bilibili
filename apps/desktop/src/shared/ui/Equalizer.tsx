export function Equalizer({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const bar = size === 'sm' ? 'h-2 w-[2px]' : 'h-3 w-[2.5px]'
  return (
    <span className="eq flex items-end gap-[2px]" aria-hidden>
      <span className={`${bar} rounded-full bg-[var(--accent)]`} style={{ animationDelay: '0ms' }} />
      <span className={`${bar} rounded-full bg-[var(--accent)]`} style={{ animationDelay: '180ms' }} />
      <span className={`${bar} rounded-full bg-[var(--accent)]`} style={{ animationDelay: '360ms' }} />
    </span>
  )
}
