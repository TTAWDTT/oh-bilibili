import type { Accent } from '../shared/lib/accent'

/** 色晕随封面主色换色；换色用整层重建 + 淡入，避免渐变在旧色与新色之间硬切。 */
export function Aurora({ accent }: { accent: Accent }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div key={`glow-${accent.hue}`} className="aurora-in absolute inset-0">
        <div
          className="aurora-blob aurora-nebula"
          style={{
            left: '-12%',
            top: '-18%',
            width: '58%',
            height: '74%',
            background: `radial-gradient(circle at 42% 40%, ${accent.soft}, transparent 62%)`,
          }}
        />
        <div
          className="aurora-blob aurora-ember"
          style={{
            right: '-16%',
            top: '4%',
            width: '54%',
            height: '70%',
            background: `radial-gradient(circle at 50% 50%, hsl(${(accent.hue + 22) % 360} 90% 58% / 0.24), transparent 66%)`,
            animationDelay: '-7s',
          }}
        />
        <div
          className="aurora-blob aurora-nebula"
          style={{
            left: '20%',
            bottom: '-32%',
            width: '62%',
            height: '70%',
            background: `radial-gradient(circle at 50% 50%, hsl(${(accent.hue + 334) % 360} 84% 58% / 0.18), transparent 68%)`,
            animationDelay: '-13s',
          }}
        />
      </div>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(75% 60% at 50% 0%, rgba(255,255,255,0.05), transparent 70%)' }}
      />
    </div>
  )
}
