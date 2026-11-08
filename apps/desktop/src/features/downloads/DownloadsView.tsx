import type { DownloadState } from '../../shared/lib/contract'
import { copyText } from '../../shared/lib/clipboard'
import { useAppStore } from '../../app/appStore'
import { toastDone, toastFailure } from '../../app/notice'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { Skeleton } from '../../shared/ui/Skeleton'
import { useDownloadsStore } from './downloadsStore'

const STATE: Record<DownloadState, { label: string; tone: string }> = {
  queued: { label: '排队中', tone: 'text-[var(--text-2)]' },
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
  const navigate = useAppStore((state) => state.navigate)

  return (
    <div className="flex h-full flex-col">
      

      <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-6">
        {items === null ? (
          <div aria-hidden>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-2 border-b border-hairline px-4 py-4">
                <Skeleton className="h-10 w-10 shrink-0 rounded-[4px]" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-48 max-w-[45%]" />
                  <Skeleton className="h-2.5 w-64 max-w-[60%]" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <EmptyState
              icon="download"
              title="还没有下载，离线听要趁早"
              detail="在任意歌曲上点下载箭头，音轨会存到本机，断网也能听。"
              action={{ label: '去搜索', onClick: () => navigate({ kind: 'search' }) }}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-hairline px-4 pb-2 text-[10px] uppercase tracking-[0.2em] text-[var(--text-2)]">
              <span className="flex-1">曲目</span>
              <span className="w-16 text-right">进度</span>
            </div>
            {items.map((item) => {
              const state = STATE[item.state]
              return (
                <div key={item.key} className="group flex items-center gap-2 border-b border-hairline px-4 py-3">
                  <Cover
                    cover={null}
                    title={item.title}
                    className="h-10 w-10 shrink-0 rounded-[4px] border border-[var(--line)]"
                    glyphClassName="text-[16px] font-medium text-[var(--text-2)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-[var(--text-2)] group-hover:text-[var(--text-1)]" title={item.title}>
                        {item.title}
                      </span>
                      <span className={`shrink-0 text-[10px] ${state.tone}`}>{state.label}</span>
                    </div>
                    {item.state === 'running' ? (
                      <div className="mt-2 h-[2px] w-full overflow-hidden bg-white/32">
                        {/* 进度用 scaleX 而不是 width，跑进度时不触发布局 */}
                        <div
                          className="t h-full origin-left"
                          style={{
                            transform: `scaleX(${item.progress})`,
                            background: 'linear-gradient(90deg, var(--accent), var(--accent-deep))',
                          }}
                        />
                      </div>
                    ) : item.path ? (
                      <button
                        type="button"
                        onClick={() => void copyPath(item.path ?? '')}
                        title="复制文件路径"
                        className="t mt-1.5 flex max-w-full items-center gap-1 text-left text-[11px] text-[var(--text-2)] hover:text-[var(--text-2)]"
                      >
                        <Icon name="copy" size={11} className="shrink-0" />
                        <span className="truncate">{item.path}</span>
                      </button>
                    ) : (
                      <div className="mt-1.5 text-[11px] text-[var(--text-2)]">等待开始</div>
                    )}
                  </div>
                  <span className="flex w-16 shrink-0 justify-end">
                    {item.state === 'done' ? (
                      <span className="text-[#7bf0a0]">
                        <Icon name="check" size={16} />
                      </span>
                    ) : item.state === 'failed' ? (
                      <span className="text-[#ff6b8a]">
                        <Icon name="alert" size={16} />
                      </span>
                    ) : (
                      <span className="num font-mono text-[10px] text-[var(--text-2)]">{Math.round(item.progress * 100)}%</span>
                    )}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
