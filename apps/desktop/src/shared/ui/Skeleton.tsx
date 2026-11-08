export function Skeleton({ className }: { className: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />
}

export function TrackListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-1" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-xl px-3 py-2.5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-44 max-w-[45%]" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-2.5 w-9" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function PlaylistGridSkeleton({ cards }: { cards: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" aria-hidden>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="rounded-2xl border border-hairline bg-white/[0.02] p-3.5">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <Skeleton className="mt-3.5 h-3.5 w-3/5" />
          <Skeleton className="mt-2 h-2.5 w-2/5" />
        </div>
      ))}
    </div>
  )
}
