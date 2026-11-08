export function Skeleton({ className }: { className: string }) {
  return <div className={`skeleton rounded-[3px] ${className}`} />
}

export function TrackListSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
          <Skeleton className="h-3 w-3 shrink-0" />
          <Skeleton className="h-9 w-9 shrink-0 rounded-[6px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-44 max-w-[45%]" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-2.5 w-9" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

export function PlaylistRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-hairline px-4 py-4">
          <Skeleton className="h-3.5 w-3.5 shrink-0" />
          <Skeleton className="h-3.5 w-40" />
          <span className="flex-1" />
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  )
}
