import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliTvLoading } from '../../shared/ui/BiliTvLoading'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'

export function DynamicView() {
  const navigate = useAppStore((state) => state.navigate)
  const [items, setItems] = useState<ipc.DynamicItem[]>([])
  const [offset, setOffset] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)

  const load = useCallback(async (next: string | null, append: boolean): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    setError(null)
    try {
      const page = await ipc.dynamicFeed(next)
      setItems((prev) => (append ? [...prev, ...page.items] : page.items))
      setOffset(page.offset)
      setHasMore(page.has_more)
      setLoaded(true)
    } catch (cause) {
      setError(toWireError(cause).message)
    } finally {
      pending.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(null, false)
  }, [load])

  if (!loaded && loading) return <BiliTvLoading label="正在取动态" />
  if (error && items.length === 0) {
    return (
      <EmptyState
        icon="alert"
        title="动态没取到"
        detail={error}
        action={{ label: '重试', onClick: () => void load(null, false) }}
      />
    )
  }
  if (loaded && items.length === 0) {
    return (
      <EmptyState
        icon="biliTv"
        title="关注的人还没有新视频"
        action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
      />
    )
  }

  return (
    <div id="scroll-main" className="min-h-0 flex-1 overflow-y-auto pb-10">
      <header className="bg-[var(--panel)] py-4">
        <div className="mx-auto w-full max-w-[640px] px-4 md:px-8">
          <PageTitle>动态</PageTitle>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[640px] px-4 md:px-8">
        {items.map((item) => (
          <article key={item.id} className="flex gap-3 border-b border-hairline py-4">
            <Avatar src={item.face} alt={item.author} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate({ kind: 'author', name: item.author, mid: item.mid })
                  }
                  className="t press text-[13px] font-medium text-[var(--text-1)] hover:text-[var(--accent)]"
                >
                  {item.author}
                </button>
                <span className="text-[12px] text-[var(--text-3)]">{item.pub_time}</span>
              </div>
              {item.text ? (
                <p className="mt-1 line-clamp-2 text-[14px] leading-[22px] text-[var(--text-1)]">
                  {item.text}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  navigate({
                    kind: 'watch',
                    track: {
                      key: item.bvid,
                      title: item.title,
                      artist: item.author,
                      cover: item.cover,
                      duration_ms: item.duration_ms,
                      views: item.views,
                      danmaku: item.danmaku,
                      up_avatar: item.face,
                      up_mid: item.mid,
                    },
                  })
                }
                className="group mt-2 flex w-full gap-3 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] p-2 text-left hover:border-[var(--accent)]"
              >
                <span
                  className="relative block w-[180px] shrink-0 overflow-hidden rounded-[4px]"
                  style={{ aspectRatio: '16 / 10' }}
                >
                  <Cover cover={item.cover} title={item.title} width={180} className="h-full w-full" />
                  <span className="num absolute bottom-1 right-1 rounded-[2px] bg-black/70 px-1 text-[11px] leading-[16px] text-white">
                    {formatDuration(item.duration_ms)}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 text-[14px] leading-[20px] text-[var(--text-1)] group-hover:text-[var(--accent)]">
                    {item.title}
                  </span>
                  <span className="num mt-1 flex items-center gap-3 text-[12px] text-[var(--text-3)]">
                    <span className="flex items-center gap-1">
                      <Icon name="play" size={12} />
                      {formatCount(item.views)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Icon name="danmaku" size={12} />
                      {formatCount(item.danmaku)}
                    </span>
                  </span>
                </span>
              </button>
            </div>
          </article>
        ))}
        {error && items.length > 0 ? (
          <div className="flex justify-center py-5">
            <button
              type="button"
              onClick={() => void load(offset, true)}
              className="t press text-[13px] text-[var(--accent)] hover:underline"
            >
              没取到，重试
            </button>
          </div>
        ) : hasMore ? (
          <div className="flex justify-center py-5">
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(offset, true)}
              className="t press h-8 rounded-[4px] border border-[var(--line)] px-4 text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-50"
            >
              加载更多
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
