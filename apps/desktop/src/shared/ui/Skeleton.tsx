export function Skeleton({ className }: { className: string }) {
  return <div className={`bili-skeleton rounded-[3px] ${className}`} />
}

export function TrackListSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-2 border-b border-hairline px-4 py-1">
          <Skeleton className="h-3 w-3 shrink-0" />
          <Skeleton className="h-9 w-9 shrink-0 rounded-[4px]" />
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
        <div key={index} className="flex items-center gap-2 border-b border-hairline px-4 py-4">
          <Skeleton className="h-3.5 w-3.5 shrink-0" />
          <Skeleton className="h-3.5 w-40" />
          <span className="flex-1" />
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  )
}

/** 封面卡片网格的骨架。首屏还没到数据时用它占位，比一行「正在取」稳定得多。 */
export function CardGridSkeleton({ cards }: { cards: number }) {
  return (
    <div
      aria-hidden
      className="grid gap-x-5 gap-y-7 pb-6 [grid-template-columns:repeat(auto-fill,minmax(206px,1fr))]"
    >
      {Array.from({ length: cards }, (_, index) => (
        <div key={index}>
          <Skeleton className="aspect-[16/10] w-full rounded-[8px]" />
          <Skeleton className="mt-2.5 h-3.5 w-full" />
          <Skeleton className="mt-1.5 h-3.5 w-4/5" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
      ))}
    </div>
  )
}
