import { useState } from 'react'
import { reportActionError } from '../../shared/lib/actionError'
import type { DownloadState, DownloadView } from '../../shared/lib/contract'
import { copyText } from '../../shared/lib/clipboard'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import { toastDone, toastFailure } from '../../app/notice'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Modal } from '../../shared/ui/Modal'
import { PageTitle } from '../../shared/ui/PageTitle'
import { Icon } from '../../shared/ui/Icon'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { useDownloadsStore } from './downloadsStore'

const STATE: Record<DownloadState, { label: string; tone: string }> = {
  queued: { label: '排队中', tone: 'text-[var(--text-2)]' },
  running: { label: '下载中', tone: 'text-[var(--accent)]' },
  // 浅色底上的绿与红：原来那对 #7bf0a0 / #ff6b8a 是深色主题的霓虹色，ui-audit-ok
  // 白底上几乎看不见。用 ToastHost 同一套语义色，成功与失败全应用一致。
  done: { label: '已完成', tone: 'text-[var(--ok)]' },
  failed: { label: '失败', tone: 'text-[var(--danger)]' },
  missing: { label: '文件已移走', tone: 'text-[var(--danger)]' },
}

async function copyPath(path: string): Promise<void> {
  const copied = await copyText(path)
  if (copied) toastDone('路径已复制', path)
  else toastFailure('复制路径', { class: 'internal', message: '剪贴板不可用' })
}

export function DownloadsView() {
  const items = useDownloadsStore((state) => state.items)
  const retry = useDownloadsStore((state) => state.retry)
  const focusSearch = useAppStore((state) => state.focusSearch)
  const [deleting, setDeleting] = useState<DownloadView | null>(null)

  const reveal = async (key: string): Promise<void> => {
    try {
      await ipc.downloadReveal(key)
    } catch (e) {
      reportActionError('打开位置', e)
    }
  }

  const remove = async (key: string, withFile: boolean): Promise<void> => {
    try {
      // 删除后重新拉一次列表，保证界面与磁盘一致
      await ipc.downloadRemove(key)
      await useDownloadsStore.getState().load()
      toastDone(withFile ? '已删除本地音频' : '已移除下载记录')
    } catch (e) {
      reportActionError('删除下载', e)
    }
  }

  /** 会删磁盘文件的条目先确认；文件和记录都要走的操作不能一键发生。 */
  const askRemove = (item: DownloadView): void => {
    if (item.state === 'done' && item.path) {
      setDeleting(item)
      return
    }
    void remove(item.key, false)
  }

  const confirmRemove = async (): Promise<void> => {
    const item = deleting
    if (!item) return
    setDeleting(null)
    await remove(item.key, true)
  }

  return (
    <div className="flex h-full flex-col">
      

      <div
        id="scroll-main"
        className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 md:px-8"
      >
        <PageTitle
          action={
            <button
              type="button"
              onClick={() =>
                void ipc
                  .downloadOpenDir()
                  .catch((cause) => toastFailure('打开下载目录', cause))
              }
              className="t press flex h-8 items-center gap-2 rounded-[4px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Icon name="folder" size={14} />
              打开目录
            </button>
          }
        >
          已下载
        </PageTitle>
        {items === null ? (
          <BiliLoader compact label="正在取下载…" />
        ) : items.length === 0 ? (
          <div className="pt-6">
            <EmptyState
              mascot="coin"
              icon="download"
              title="还没有下载，离线听要趁早"
              action={{ label: '去搜索', onClick: () => focusSearch() }}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-hairline px-4 pb-2 text-[12px] uppercase tracking-[0.2em] text-[var(--text-2)]">
              <span className="flex-1">曲目</span>
              <span className="w-16 text-right">进度</span>
            </div>
            {items.map((item) => {
              const meta = STATE[item.state]
              return (
                <div key={item.key} className="group flex items-center gap-2 border-b border-hairline px-4 py-3">
                  <Cover
                    cover={null}
                    title={item.title}
                    className="h-10 w-10 shrink-0 rounded-[4px] border border-[var(--line)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] text-[var(--text-2)] group-hover:text-[var(--text-1)]" title={item.title}>
                        {item.title}
                      </span>
                      <span className={`shrink-0 text-[12px] ${meta.tone}`}>{meta.label}</span>
                    </div>
                    {item.state === 'running' ? (
                      <div className="mt-2 h-[2px] w-full overflow-hidden bg-white/32">
                        {/* 进度用 scaleX 而不是 width，跑进度时不触发布局 */}
                        <div
                          className="t h-full origin-left"
                          style={{
                            transform: `scaleX(${item.progress})`,
                            background: 'var(--accent)',
                          }}
                        />
                      </div>
                    ) : item.path ? (
                      <button
                        type="button"
                        onClick={() => void copyPath(item.path ?? '')}
                        title="复制文件路径"
                        className="t mt-1.5 flex max-w-full items-center gap-1 text-left text-[12px] text-[var(--text-2)] hover:text-[var(--text-2)]"
                      >
                        <Icon name="copy" size={11} className="shrink-0" />
                        <span className="truncate">{item.path}</span>
                      </button>
                    ) : item.error ? (
                      <div
                        className="mt-1.5 line-clamp-2 max-w-full text-[12px] text-[var(--danger)]"
                        title={item.error}
                      >
                        {item.error}
                      </div>
                    ) : null}
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 transition-opacity ${
                      item.state === 'failed' || item.state === 'missing'
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                    }`}
                  >
                    {item.state === 'failed' || item.state === 'missing' ? (
                      <button
                        type="button"
                        aria-label={`重试下载 ${item.title}`}
                        title="重试"
                        onClick={() => void retry(item.key)}
                        className="flex h-5 w-5 items-center justify-center rounded-[3px] text-[var(--text-3)] hover:bg-[var(--hover)] hover:text-[var(--accent)]"
                      >
                        <Icon name="refresh" size={13} />
                      </button>
                    ) : null}
                    {item.state === 'done' ? (
                      <button
                        type="button"
                        aria-label={`在文件夹中显示 ${item.title}`}
                        title="在文件夹中显示"
                        onClick={() => void reveal(item.key)}
                        className="flex h-5 w-5 items-center justify-center rounded-[3px] text-[var(--text-3)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]"
                      >
                        <Icon name="library" size={13} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={
                        item.state === 'done'
                          ? `删除本地音频 ${item.title}`
                          : `移除下载记录 ${item.title}`
                      }
                      title={item.state === 'done' ? '删除本地音频' : '移除下载记录'}
                      onClick={() => askRemove(item)}
                      className="flex h-5 w-5 items-center justify-center rounded-[3px] text-[var(--text-3)] hover:bg-[var(--hover)] hover:text-[var(--accent)]"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                  <span className="flex w-16 shrink-0 justify-end">
                    {item.state === 'done' ? (
                      <span className="text-[var(--ok)]">
                        <Icon name="check" size={16} />
                      </span>
                    ) : item.state === 'failed' || item.state === 'missing' ? (
                      <span className="text-[var(--danger)]">
                        <Icon name="alert" size={16} />
                      </span>
                    ) : (
                      <span className="num font-mono text-[12px] text-[var(--text-2)]">{Math.round(item.progress * 100)}%</span>
                    )}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </div>
      <Modal
        open={deleting !== null}
        title="删除本地音频？"
        description={null}
        onClose={() => setDeleting(null)}
      >
        <p className="text-[14px] leading-relaxed text-[var(--text-1)]">
          将从磁盘删除《{deleting?.title}》的音频文件，并把这条记录从列表移除。
        </p>
        {deleting?.path ? (
          <p className="mt-2 break-all font-mono text-[12px] text-[var(--text-3)]">
            {deleting.path}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDeleting(null)}
            className="bili-press rounded-[6px] border border-[var(--line)] px-3 py-1.5 text-[13px] text-[var(--text-2)] hover:text-[var(--text-1)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void confirmRemove()}
            className="bili-press rounded-[6px] bg-[var(--danger)] px-3 py-1.5 text-[13px] text-white hover:opacity-90"
          >
            删除音频
          </button>
        </div>
      </Modal>
    </div>
  )
}
