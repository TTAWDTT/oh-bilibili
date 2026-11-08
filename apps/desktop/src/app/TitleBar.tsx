import { Icon } from '../shared/ui/Icon'
export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="relative z-20 flex h-7 shrink-0 items-center justify-between border-b border-hairline bg-[var(--panel-alt)] pl-[80px] pr-3"
    >
      <div className="flex items-center gap-2">
        <span className="bili-tv-mark text-[var(--accent)]">
          <Icon name="biliTv" size={15} />
        </span>
        <span className="text-[14px] text-[var(--text-2)]">BILIMUSIC</span>
        <span className="rounded-[3px] border border-hairline px-2 text-[12px] text-[var(--text-3)]">
          ALPHA
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
        <span className="h-1 w-1 rounded-full bg-[var(--accent)]" />
        本机直连
      </div>
    </div>
  )
}
