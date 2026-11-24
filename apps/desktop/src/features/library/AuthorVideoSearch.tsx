import { useEffect, useState } from 'react'
import { useAppStore, type AuthorRoute } from '../../app/appStore'
import { spaceVideos } from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { ContentGrid } from '../tracks/ContentGrid'
import { usePlayerStore } from '../player/playerStore'

export function AuthorVideoForm({ view }: { view: AuthorRoute }) {
  const [draft, setDraft] = useState(view.videoQuery ?? '')
  const replace = useAppStore(s => s.replace)
  const submit = (query: string) => replace({ ...view, videoQuery: query.trim(), videoPage: 1 })
  return <form role="search" aria-label="搜索这个 UP 主的投稿" className="flex min-w-0 max-w-full items-center gap-2"
    onSubmit={event => { event.preventDefault(); submit(draft) }}>
    <div className="flex h-8 w-[178px] min-w-0 items-center rounded-[6px] border border-[var(--line)] bg-[var(--panel)] pl-2.5 text-[var(--text-2)] focus-within:border-[var(--accent)]">
      <input type="search" value={draft} aria-label="搜索 TA 的投稿" placeholder="搜索 TA 的投稿"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-1)] outline-none" onChange={e => setDraft(e.target.value)} />
      <button type="submit" aria-label="搜索" title="搜索" className="t press grid h-full w-8 shrink-0 place-items-center hover:text-[var(--accent)]">
        <Icon name="search" size={15} />
      </button>
    </div>
    {view.videoQuery && <button type="button" className="t press shrink-0 text-[13px] text-[var(--accent-strong)]" onClick={() => submit('')}>全部投稿</button>}
  </form>
}

export function AuthorVideoResults({ view, mid, query }: { view: AuthorRoute; mid: number; query: string }) {
  const page = view.videoPage ?? 1
  const replace = useAppStore(s => s.replace)
  const snapshot = usePlayerStore(s => s.snapshot)
  const [result, setResult] = useState<[Track[], number] | 'error' | null>(null)
  const [attempt, retry] = useState(0)
  useEffect(() => {
    let active = true
    void spaceVideos(mid, page, 'pubdate', query)
      .then(data => { if (active) setResult(data) }).catch(() => { if (active) setResult('error') })
    return () => { active = false }
  }, [mid, page, query, attempt])
  if (!result) return <BiliLoader label="正在搜索 TA 的投稿…" />
  if (result === 'error') return <p className="py-4 text-sm">投稿搜索暂时不可用。<button className="px-2 text-[var(--accent)]"
    onClick={() => { setResult(null); retry(n => n + 1) }}>重试</button></p>
  const [tracks, total] = result
  return <section aria-label="投稿搜索结果">
    <p className="mb-3 text-[13px] text-[var(--text-3)]">{total ? `共 ${total} 个相关投稿` : '没有找到相关投稿'}</p>
    {tracks.length > 0 && <ContentGrid tracks={tracks} activeKey={snapshot?.track?.key ?? null} playing={snapshot?.phase === 'playing'} />}
    {(page > 1 || total > 50) && <nav aria-label="投稿搜索翻页" className="mt-5 flex justify-center gap-4 text-sm">
      <button type="button" className="disabled:opacity-40" disabled={page === 1} onClick={() => replace({ ...view, videoPage: page - 1 })}>上一页</button>
      <span>第 {page} 页</span>
      <button type="button" className="disabled:opacity-40" disabled={page * 50 >= total} onClick={() => replace({ ...view, videoPage: page + 1 })}>下一页</button>
    </nav>}
  </section>
}
