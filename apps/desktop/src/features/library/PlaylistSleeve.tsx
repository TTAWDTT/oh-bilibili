import type { Track } from '../../shared/lib/contract'
import { thumbWide } from '../../shared/lib/thumb'

type PlaylistSleeveProps = {
  name: string
  tracks: readonly Track[] | undefined
  className?: string
}

function SleeveTile({ cover, title }: { cover: string; title: string }) {
  const src = thumbWide(cover, 480) ?? cover
  return (
    <span className="relative block h-full w-full min-h-0 overflow-hidden bg-[var(--ga1)]">
      <img
        src={src}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-md"
      />
      <img
        src={src}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className="relative h-full w-full object-contain"
        title={title}
      />
    </span>
  )
}

export function PlaylistSleeve({ name, tracks, className = '' }: PlaylistSleeveProps) {
  const covers = (tracks ?? [])
    .flatMap((track) => (track.cover ? [{ cover: track.cover, title: track.title }] : []))
    .slice(0, 4)
  const first = covers[0]!

  return (
    <span
      data-cover-count={covers.length}
      className={`relative block aspect-square overflow-hidden rounded-[7px] border border-[var(--line)] bg-[var(--ga1)] shadow-[0_3px_14px_-8px_rgba(24,25,28,0.28)] ${className}`}
    >
      {covers.length === 0 ? (
        <span className="flex h-full w-full items-center justify-center bg-[color-mix(in_srgb,var(--accent)_12%,white)] px-3 text-center text-[22px] font-medium leading-tight text-[var(--accent-strong)]">
          {name.trim().slice(0, 2) || '歌单'}
        </span>
      ) : covers.length === 1 ? (
        <SleeveTile cover={first.cover} title={first.title} />
      ) : covers.length === 2 ? (
        <span className="grid h-full w-full grid-cols-2 gap-px">
          {covers.map((cover, index) => (
            <SleeveTile key={`${cover.title}-${index}`} cover={cover.cover} title={cover.title} />
          ))}
        </span>
      ) : covers.length === 4 ? (
        <span className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
          {covers.map((cover, index) => (
            <SleeveTile key={`${cover.title}-${index}`} cover={cover.cover} title={cover.title} />
          ))}
        </span>
      ) : (
        <span className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
          <span className="row-span-2 grid min-h-0">
            <SleeveTile cover={first.cover} title={first.title} />
          </span>
          {covers.slice(1, 3).map((cover, index) => (
            <SleeveTile key={`${cover.title}-${index + 1}`} cover={cover.cover} title={cover.title} />
          ))}
        </span>
      )}
    </span>
  )
}
