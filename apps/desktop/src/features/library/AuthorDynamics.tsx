import { useCallback, useEffect, useRef, useState } from 'react'
import { toastFailure } from '../../app/notice'
import { openExternal, spaceDynamics, type DynamicItem } from '../../shared/lib/ipc'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { FeedCard } from '../home/DynamicView'

export function AuthorDynamics({ mid }: { mid: number }) {
  const [items, setItems] = useState<DynamicItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const site = `https://space.bilibili.com/${mid}/dynamic`

  const load = useCallback(async (cursor: string | null) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setFailed(false)
    try {
      const page = await spaceDynamics(mid, cursor)
      setItems((old) => {
        if (!cursor) return page.items
        const seen = new Set(old.map(item => item.id))
        return [...old, ...page.items.filter(item => !seen.has(item.id))]
      })
      setNext(page.has_more ? page.offset : null)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      pending.current = false
    }
  }, [mid])

  useEffect(() => { void load(null) }, [load])

  const keyword = query.trim().toLocaleLowerCase()
  const shown = keyword ? items.filter(item => {
    for (let entry: DynamicItem | null | undefined = item; entry; entry = entry.orig) {
      if ([entry.text, entry.title, entry.attachment?.title].some(text => text?.toLocaleLowerCase().includes(keyword))) return true
    }
    return false
  }) : items

  return <section aria-label="作者动态" className="mx-auto grid w-full max-w-[700px] gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex min-w-0 items-center gap-1.5 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-2.5">
        <Icon name="search" size={14} className="text-[var(--text-3)]" />
        <input type="search" aria-label="搜索已加载的动态" placeholder="搜索已加载的动态"
          className="h-8 w-36 min-w-0 bg-transparent text-[13px] outline-none" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <a href={site} onClick={(event) => {
        event.preventDefault()
        void openExternal(site).catch(cause => toastFailure('打开作者动态', cause))
      }} className="t ml-auto inline-flex items-center gap-1 text-[13px] text-[var(--accent)] hover:underline">
        在 B 站查看作者动态 <Icon name="external" size={12} />
      </a>
    </div>
    {keyword && items.length > 0 && !shown.length && <p className="py-4 text-center text-[14px] text-[var(--text-2)]">已加载的动态里没有找到「{query.trim()}」</p>}
    {shown.map(item => <FeedCard key={item.id} item={item} />)}
    {busy ? <BiliLoader compact label="正在取作者动态…" /> : failed ? (
      <EmptyState compact icon="alert" title={items.length ? '后续动态暂时没取到' : '作者动态暂时没取到'}
        action={{ label: '重试', onClick: () => void load(next) }} />
    ) : next ? (
      <button type="button" onClick={() => void load(next)}
        className="t mx-auto py-3 text-[14px] text-[var(--accent)] hover:underline">更多动态</button>
    ) : !items.length && <p className="py-8 text-center text-[14px] text-[var(--text-2)]">还没有公开动态</p>}
  </section>
}
