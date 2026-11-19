import { useEffect, useState } from 'react'
import { formatTime } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'

/** B 站的 AI 视频总结：摘要常驻两行，展开后是按时间点分段的提纲。 */
export function SummaryCard({
  trackKey,
  cid,
  upMid,
  onSeek,
}: {
  trackKey: string
  cid: number
  upMid: number
  onSeek: (ms: number) => void
}) {
  const [summary, setSummary] = useState<ipc.VideoSummary | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setOpen(false)
    void ipc
      .watchSummary(trackKey, cid, upMid)
      .then((value) => {
        if (!cancelled) setSummary(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [trackKey, cid, upMid])

  if (!summary) return null

  return (
    <div className="mt-3 max-w-[820px] overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="rounded-[3px] bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-1.5 text-[11px] font-medium leading-[18px] text-[var(--accent)]">
          AI
        </span>
        <h3 className="text-[13px] font-medium text-[var(--text-1)]">视频总结</h3>
        {summary.outline.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="t ml-auto text-[12px] text-[var(--accent)] hover:underline"
          >
            {open ? '收起' : '展开'}
          </button>
        ) : null}
      </div>
      <p
        className={`px-3 pb-2 pt-1 text-[13px] leading-[1.65] text-[var(--text-2)] ${
          open ? '' : 'line-clamp-2'
        }`}
      >
        {summary.summary}
      </p>
      {open && summary.outline.length > 0 ? (
        <ol className="border-t border-hairline px-3 py-2">
          {summary.outline.map((section, index) => (
            <li key={`${section.at_ms}-${index}`} className="mt-2 first:mt-0">
              <button
                type="button"
                onClick={() => onSeek(section.at_ms)}
                className="t flex min-w-0 items-center gap-2 text-[12px] hover:underline"
              >
                <span className="num shrink-0 text-[var(--accent)]">{formatTime(section.at_ms)}</span>
                <span className="truncate text-[var(--text-1)]">{section.title}</span>
              </button>
              {section.points.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {section.points.map((point, pointIndex) => (
                    <li
                      key={`${point.at_ms}-${pointIndex}`}
                      className="flex items-start gap-2 text-[12px] leading-[1.55] text-[var(--text-2)]"
                    >
                      <button
                        type="button"
                        onClick={() => onSeek(point.at_ms)}
                        className="num t shrink-0 text-[var(--accent)] hover:underline"
                      >
                        {formatTime(point.at_ms)}
                      </button>
                      <span>{point.content}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
