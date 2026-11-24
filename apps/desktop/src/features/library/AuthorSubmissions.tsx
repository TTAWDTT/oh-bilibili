import { useMemo } from 'react'
import { useAppStore, type AuthorRoute } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import type { Track } from '../../shared/lib/contract'
import { openExternal } from '../../shared/lib/ipc'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { EmptyState } from '../../shared/ui/EmptyState'
import { usePlayerStore } from '../player/playerStore'
import { ContentGrid } from '../tracks/ContentGrid'
import { AuthorVideoForm, AuthorVideoResults } from './AuthorVideoSearch'

const orders = [['pubdate', '最新发布'], ['click', '最多播放'], ['stow', '最多收藏']] as const
type Order = (typeof orders)[number][0]

type Props = {
  view: AuthorRoute
  tracks: Track[] | null
  pinned: Track | null
  order: Order
  onOrder: (order: Order) => void
  isFallback: boolean
  loadingMore: boolean
  onNeedMore: () => void
}

export function AuthorSubmissions({ view, tracks, pinned, order, onOrder, isFallback, loadingMore, onNeedMore }: Props) {
  const activeKey = usePlayerStore(state => state.snapshot?.track?.key ?? null)
  const playing = usePlayerStore(state => state.snapshot?.phase === 'playing')
  const focusSearch = useAppStore(state => state.focusSearch)
  const searchFor = useAppStore(state => state.setHeroQuery)
  const { mid, videoQuery } = view
  const gallery = useMemo(() => {
    const list = tracks ?? []
    return pinned ? [pinned, ...list.filter(track => track.key !== pinned.key)] : list
  }, [tracks, pinned])

  return <section aria-label="作者投稿" className="min-w-0">
    {mid && (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {!videoQuery && !isFallback && !!tracks?.length && (
          <div role="group" aria-label="投稿排序" className="flex max-w-full flex-wrap items-center gap-0.5">
            {orders.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={order === value} onClick={() => onOrder(value)}
                className={`t press rounded-[5px] px-2 py-1.5 text-[13px] ${order === value
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]'
                  : 'text-[var(--text-2)] hover:bg-[var(--panel-raised)]'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <AuthorVideoForm key={videoQuery ?? ''} view={view} />
      </div>
    )}

    {mid && videoQuery ? (
      <AuthorVideoResults key={JSON.stringify([videoQuery, view.videoPage])} view={view} mid={mid} query={videoQuery} />
    ) : <>
      {isFallback && tracks && gallery.length > 0 && (
        <p className="mb-3 text-[13px] text-[var(--text-2)]">
          {tracks.length ? `来自搜索结果，共 ${tracks.length} 个` : '空间投稿暂时没取到'}
        </p>
      )}
      {gallery.length > 0 && <ContentGrid tracks={gallery} pinnedKey={pinned?.key}
        activeKey={activeKey} playing={playing} onNeedMore={onNeedMore} />}
      {tracks === null ? <BiliLoader label="正在取投稿…" /> : gallery.length === 0 ? (
        <EmptyState icon="biliTv" compact
          title={!mid ? '没找到这个 UP 主' : isFallback ? '空间投稿暂时没取到' : '这个 UP 主还没有公开投稿'}
          action={mid ? {
            label: '在 B 站打开空间',
            onClick: () => void openExternal(`https://space.bilibili.com/${mid}`).catch(cause => toastFailure('打开空间', cause)),
          } : { label: '回到搜索', onClick: focusSearch }}
        />
      ) : loadingMore ? <BiliLoader compact label="正在取更多投稿…" /> : null}
      {isFallback && gallery.length > 0 && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={() => searchFor(view.name)}
            className="bili-press rounded-[6px] border border-[var(--line)] px-4 py-2 text-sm text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
            在搜索里找他更多的投稿 →
          </button>
        </div>
      )}
    </>}
  </section>
}
