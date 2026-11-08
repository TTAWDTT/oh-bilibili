export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-hairline bg-white/[0.018] pl-[92px] pr-6"
    >
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium tracking-[0.26em] text-white/36">BILIMUSIC</span>
        <span className="rounded-[4px] border border-hairline px-2 py-[1px] text-[9px] tracking-[0.12em] text-white/30">
          ALPHA
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-white/24">
        <span className="h-1 w-1 rounded-full bg-[var(--accent)]" />
        本机直连
      </div>
    </div>
  )
}
