import { useEffect, useState } from 'react'
import { useAppStore, type AuthorRoute } from '../../app/appStore'
import type { Track } from '../../shared/lib/contract'
import { spaceCollections, spaceCollectionWorks, type SpaceCollection } from '../../shared/lib/ipc'
import { Cover } from '../../shared/ui/Cover'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'

type Directory =
  | { kind: 'collections'; entries: SpaceCollection[]; total: number }
  | { kind: 'works'; entries: Track[]; total: number }

export function AuthorCollections({ view, mid }: { view: AuthorRoute; mid: number }) {
  const navigate = useAppStore((s) => s.navigate)
  const replace = useAppStore((s) => s.replace)
  const goBack = useAppStore((s) => s.goBack)
  const { shelf, shelfPage: page = 1 } = view
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const request: Promise<Directory> = shelf
      ? spaceCollectionWorks(mid, shelf.kind, shelf.id, page).then(([entries, total]) => ({ kind: 'works', entries, total }))
      : spaceCollections(mid, page).then(([entries, total]) => ({ kind: 'collections', entries, total }))
    void request.then(result => { if (active) setDirectory(result) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [mid, shelf, page, attempt])

  const pages = Math.ceil((directory?.total ?? 0) / (shelf ? 30 : 12))
  const button = 'group min-w-0 text-left'
  const grid = 'grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3 xl:grid-cols-4'
  const caption = 'mt-2 block line-clamp-2 break-words text-[14px] font-medium text-[var(--text-1)] group-hover:text-[var(--accent)]'
  const link = 't press text-[13px] text-[var(--text-2)] hover:text-[var(--accent)] disabled:opacity-40'

  return (
    <section aria-label={shelf?.name || '合集和系列'}>
      {shelf && (
        <div className="mb-4">
          <button type="button" className={link + ' mb-2 inline-flex items-center gap-1'} onClick={goBack}>
            <Icon name="chevronLeft" size={14} />返回合集和系列
          </button>
          <h3 className="break-words text-[18px] font-semibold">{shelf.name}</h3>
        </div>
      )}
      {failed ? (
        <div className="py-6 text-[14px] text-[var(--text-2)]">
          {shelf ? '作品目录暂时没取到。' : '合集和系列暂时没取到。'}
          <button type="button" className={link} onClick={() => { setFailed(false); setAttempt(n => n + 1) }}>重试</button>
        </div>
      ) : !directory ? <BiliLoader label="正在取目录…" /> : !directory.entries.length ? (
        <p className="py-6 text-[14px] text-[var(--text-3)]">{shelf ? '没有公开作品' : '还没有公开的合集或系列'}</p>
      ) : directory.kind === 'collections' ? (
        <div className={grid}>
          {directory.entries.map(item => {
            const label = item.kind === 'season' ? '合集' : '系列'
            const focus = `space-shelf:${item.kind}:${item.id}`
            return (
              <button type="button" key={focus} data-space-collection data-focus-id={focus} aria-label={`打开${label} ${item.name}`}
                className={button} onClick={() => navigate({ ...view, shelf: { kind: item.kind, id: item.id, name: item.name }, shelfPage: 1 }, undefined, focus)}>
                <span className="relative block aspect-video overflow-hidden rounded-[6px]">
                  <Cover cover={item.cover} title={item.name} width={320} className="h-full w-full" />
                  <span className="absolute bottom-1.5 right-1.5 rounded-[3px] bg-black/70 px-1.5 py-0.5 text-[12px] text-white">{label} · {item.total} 个视频</span>
                </span>
                <span className={caption}>{item.name}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className={grid}>
          {directory.entries.map(track => {
            const focus = `space-work:${track.key}`
            return (
              <button type="button" key={focus} data-collection-work data-focus-id={focus} aria-label={`观看 ${track.title}`}
                className={button} onClick={() => navigate({ kind: 'watch', track }, undefined, focus)}>
                <Cover cover={track.cover} title={track.title} width={320} className="aspect-video w-full rounded-[6px]" />
                <span className={caption}>{track.title}</span>
              </button>
            )
          })}
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="目录翻页" className="mt-6 flex items-center justify-center gap-4">
          <button type="button" className={link} disabled={page === 1} onClick={() => replace({ ...view, shelfPage: page - 1 })}>上一页</button>
          <span className="num text-[13px] text-[var(--text-3)]">{page} / {pages}</span>
          <button type="button" className={link} disabled={page >= pages} onClick={() => replace({ ...view, shelfPage: page + 1 })}>下一页</button>
        </nav>
      )}
    </section>
  )
}
