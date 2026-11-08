import type { DownloadState } from '../../shared/lib/contract'
import { copyText } from '../../shared/lib/clipboard'
import { toastDone, toastFailure } from '../../app/notice'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Skeleton } from '../../shared/ui/Skeleton'
import { useDownloadsStore } from './downloadsStore'

const STATE: Record<DownloadState, { label: string; tone: string }> = {
  queued: { label: '排队中', tone: 'text-white/46' },
  running: { label: '下载中', tone: 'text-[var(--accent)]' },
  done: { label: '已完成', tone: 'text-[#7bf0a0]' },
  failed: { label: '失败', tone: 'text-[#ff6b8a]' },
}

async function copyPath(path: string): Promise<void> {
  const copied = await copyText(path)
  if (copied) toastDone('路径已复制', path)
  else toastFailure('复制路径', { class: 'internal', message: '剪贴板不可用' })
}

export function DownloadsView() {
  const items = useDownloadsStore((state) => state.items)

  return (
    <div className="h-full overflow-y-auto px-8 pb-10 pt-7">
      <PageHeader
        eyebrow="下载"
        title="离线备份"
        subtitle="下载走本机 yt-dlp，只导出音轨，不经过任何中转。文件存到你指定的目录。"
        actions={null}
      />

      <div className="mt-7">
        {items === null ? (
          <div className="flex flex-col gap-3" aria-hidden>
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-[76px] w-full rounded-2xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="download"
            title="还没有下载"
            detail="在任意歌曲上点下载箭头，音轨会存到本机，断网也能听。"
            action={null}
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {items.map((item) => {
              const state = STATE[item.state]
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-4 rounded-2xl border border-hairline bg-white/[0.025] px-4 py-3.5"
                >
                  <Cover
                    cover={null}
                    title={item.title}
                    className="h-11 w-11 shrink-0 rounded-lg border border-white/10"
                    glyphClassName="text-[18px] font-medium text-white/55"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-white/84">{item.title}</span>
                      <span className={`shrink-0 text-[10px] ${state.tone}`}>{state.label}</span>
                    </div>
                    {item.state === 'running' ? (
                      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/12">
                        <div
                          className="h-full rounded-full transition-[width] duration-300"
                          style={{
                            width: `${Math.round(item.progress * 100)}%`,
                            background: 'linear-gradient(90deg, var(--accent), var(--accent-deep))',
                          }}
                        />
                      </div>
                    ) : item.path ? (
                      <button
                        type="button"
                        onClick={() => void copyPath(item.path ?? '')}
                        title="复制文件路径"
                        className="mt-1.5 flex max-w-full items-center gap-1.5 text-left text-[10.5px] text-white/32 transition hover:text-white/64"
                      >
                        <Icon name="copy" size={11} className="shrink-0" />
                        <span className="truncate">{item.path}</span>
                      </button>
                    ) : (
                      <div className="mt-1.5 text-[10.5px] text-white/26">等待开始</div>
                    )}
                  </div>
                  {item.state === 'done' ? (
                    <span className="shrink-0 text-[#7bf0a0]">
                      <Icon name="check" size={16} />
                    </span>
                  ) : item.state === 'failed' ? (
                    <span className="shrink-0 text-[#ff6b8a]">
                      <Icon name="alert" size={16} />
                    </span>
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] text-white/30">
                      {Math.round(item.progress * 100)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
