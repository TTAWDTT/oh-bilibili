import { useEffect, useRef, useState } from 'react'
import { useAppStore, type AuthorRoute } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import { openExternal, spaceCatalog, spaceCatalogOrder, type CatalogItem, type CatalogKind, type CatalogPage } from '../../shared/lib/ipc'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Cover } from '../../shared/ui/Cover'
import { Icon } from '../../shared/ui/Icon'

const groups = [
  { title: '作品', choices: [['opus', '图文与相簿'], ['articles', '专栏'], ['reading_lists', '文集'], ['audio', '音频'], ['courses', '课堂'], ['reservations', '预约']] },
  { title: '收藏与兴趣', choices: [['created', '创建的收藏夹'], ['collected', '订阅的收藏夹'], ['anime', '追番'], ['cinema', '追剧'], ['tags', '订阅标签'], ['games', '最近玩过的游戏'], ['coins', '最近投币的视频'], ['likes', '最近点赞的视频']] },
] as const
const link = 't press rounded px-2 py-1 text-[13px] text-[var(--text-2)] hover:text-[var(--accent)] disabled:opacity-40'

type Props = { view: AuthorRoute; mid: number }
const orderIds: Partial<Record<CatalogKind, number>> = {
  created: 2, collected: 2, articles: 8, reading_lists: 8, anime: 3, cinema: 3,
  tags: 4, coins: 5, likes: 10, opus: 9, reservations: 26, games: 25,
}

export function AuthorCatalog({ view, mid }: Props) {
  const [order, setOrder] = useState<number[]>([])
  useEffect(() => {
    let active = true
    void spaceCatalogOrder(mid).then(ids => { if (active) setOrder(ids) }).catch(() => {})
    return () => { active = false }
  }, [mid])
  return <CatalogContent key={JSON.stringify([view.catalog, view.catalogChild?.id, view.catalogPage])} view={view} mid={mid} order={order} />
}

function CatalogContent({ view, mid, order }: Props & { order: number[] }) {
  const { catalog = 'opus', catalogChild: child, catalogPage: page = 1, catalogOffsets } = view
  const navigate = useAppStore(s => s.navigate)
  const replace = useAppStore(s => s.replace)
  const goBack = useAppStore(s => s.goBack)
  const search = useAppStore(s => s.setHeroQuery)
  const [result, setResult] = useState<CatalogPage | 'error' | null>(null)
  const [attempt, retry] = useState(0)
  const offset = catalogOffsets?.[page - 2]
  const title = groups.flatMap(group => [...group.choices]).find(([kind]) => kind === catalog)![1]
  const start = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    let active = true
    void spaceCatalog(mid, child ?? { kind: catalog }, page, offset)
      .then(data => { if (active) setResult(data) })
      .catch(() => { if (active) setResult('error') })
    return () => { active = false }
  }, [mid, catalog, child, page, offset, attempt])

  function position(kind: CatalogKind) {
    const index = order.indexOf(orderIds[kind] ?? -1)
    return index === -1 ? order.length : index
  }

  function open(item: CatalogItem, focus: string) {
    const target = item.destination
    switch (target.kind) {
      case 'subscribed_season':
      case 'reading_list':
      case 'folder':
        navigate({ ...view, catalogChild: { ...target, title: item.title }, catalogPage: 1, catalogOffsets: [] }, undefined, focus)
        break
      case 'video':
        navigate({ kind: 'watch', track: target.track }, undefined, focus)
        break
      case 'search': search(target.keyword); break
      case 'reservation':
        void openExternal(`https://space.bilibili.com/${target.mid}`).catch(cause => toastFailure('打开预约所在的空间', cause))
        break
      case 'web': void openExternal(target.url).catch(cause => toastFailure('打开作品', cause)); break
    }
  }

  function flip(next: number) {
    const offsets = (catalogOffsets ?? []).slice(0, page - 1)
    if (next > page && result && result !== 'error' && result.status === 'public' && result.offset) offsets.push(result.offset)
    start.current?.scrollIntoView({ block: 'start' })
    start.current?.focus({ preventScroll: true })
    replace({ ...view, catalogPage: next, catalogOffsets: offsets })
  }

  return <section aria-label={child?.title ?? title}>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <select ref={start} aria-label="选择空间栏目" value={catalog} className="t rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[14px] text-[var(--text-1)]"
        onChange={event => {
          if (child) goBack()
          replace({ kind: 'author', name: view.name, mid, section: 'catalog', catalog: event.target.value as CatalogKind })
        }}>
        {groups.map(group => <optgroup key={group.title} label={group.title}>{[...group.choices].sort(([a], [b]) => position(a) - position(b)).map(([kind, label]) =>
          <option key={kind} value={kind}>{label}</option>)}</optgroup>)}
      </select>
      {child && <button type="button" className={link + ' inline-flex items-center gap-1'} onClick={goBack}>
        <Icon name="chevronLeft" size={14} />返回{title}
      </button>}
    </div>
    {child && <h3 className="mb-3 break-words text-[18px] font-semibold">{child.title}</h3>}
    {result === 'error' ? <div role="status" className="py-5 text-[14px] text-[var(--text-2)]">
      {child?.title ?? title}暂时没取到。<button className={link} onClick={() => { setResult(null); retry(n => n + 1) }}>重试</button>
    </div> : !result ? <BiliLoader label="正在取目录…" /> : result.status === 'private' ?
      <p className="py-5 text-[14px] text-[var(--text-3)]">UP 主没有公开{title}</p> : <>
      {result.items.length === 0 ? <p className="py-5 text-[14px] text-[var(--text-3)]">{child ? '这里还没有公开作品' : '这里还没有公开内容'}</p> : (
        <ul className="grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">{result.items.map((item, index) => {
          const focus = `space-catalog:${mid}:${catalog}:${child?.id ?? 0}:${page}:${index}`
          return <li key={focus} className="min-w-0">
            <button type="button" className="group flex w-full items-center gap-3 rounded-[6px] px-1 py-2 text-left hover:bg-[var(--panel-alt)] disabled:opacity-55"
              title={item.destination.kind === 'reservation' ? '去 B 站空间查看预约' : item.title}
              data-focus-id={focus} data-catalog-item disabled={item.destination.kind === 'unavailable'} onClick={() => open(item, focus)}>
              {item.cover && <Cover cover={item.cover} title={item.title}
                className={catalog === 'anime' || catalog === 'cinema' ? 'h-20 w-[60px] shrink-0 rounded' : 'h-[58px] w-[78px] shrink-0 rounded'} />}
              <span className="min-w-0"><span className="line-clamp-2 break-words text-[14px] font-medium group-hover:text-[var(--accent)]">{item.title}</span>
                {item.destination.kind === 'reservation' && item.destination.starts_at && <time className="mt-1 block text-[12px] text-[var(--text-2)]">
                  {new Date(item.destination.starts_at * 1000).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </time>}
                {item.detail && <span className="mt-1 block truncate text-[12px] text-[var(--text-3)]">{item.detail}</span>}
              </span>
            </button>
          </li>
        })}</ul>)}
      {(page > 1 || result.more) && <nav aria-label="公开内容翻页" className="mt-5 flex items-center justify-center gap-3">
        <button type="button" className={link} disabled={page === 1} onClick={() => flip(page - 1)}>上一页</button>
        <span className="num text-[13px] text-[var(--text-3)]">第 {page} 页</span>
        <button type="button" className={link} disabled={!result.more} onClick={() => flip(page + 1)}>下一页</button>
      </nav>}
    </>}
  </section>
}
