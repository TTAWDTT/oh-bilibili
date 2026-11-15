import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatCount, formatDuration } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliTvLoading } from '../../shared/ui/BiliTvLoading'
import { Cover } from '../../shared/ui/Cover'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'

const FEED = 'mx-auto w-full max-w-[700px] px-4 md:px-0'

function DynamicCard({
  item,
  onOpen,
  onAuthor,
  onExternal,
}: {
  item: ipc.DynamicItem
  onOpen: () => void
  onAuthor: () => void
  onExternal: () => void
}) {
  return (
    <article className="rounded-[8px] border border-[var(--line)] bg-[var(--panel)] p-4 md:p-5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onAuthor}
          aria-label={`进入 ${item.author} 的主页`}
          className="t press shrink-0 rounded-full"
        >
          <Avatar src={item.face} alt={item.author} size={48} />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onAuthor}
            className="t block max-w-full truncate text-left text-[15px] font-medium leading-[20px] text-[var(--text-1)] hover:text-[var(--accent)]"
          >
            {item.author}
          </button>
          <p className="mt-1 text-[13px] leading-[18px] text-[var(--text-3)]">{item.pub_time}</p>
        </div>
      </div>

      {item.text ? (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[24px] text-[var(--text-1)]">
          {item.text}
        </p>
      ) : null}

      <button type="button" onClick={onOpen} className="group mt-3 block w-full text-left">
        <span className="relative block aspect-video overflow-hidden rounded-[8px] bg-[var(--panel-raised)]">
          <Cover
            cover={item.cover}
            title={item.title}
            width={720}
            className="h-full w-full transition-transform duration-300 group-hover:scale-[1.02]"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white transition-transform duration-200 group-hover:scale-110">
              <Icon name="play" size={24} />
            </span>
          </span>
          <span className="num absolute bottom-2 right-2 rounded-[3px] bg-black/70 px-1.5 py-0.5 text-[12px] leading-[16px] text-white">
            {formatDuration(item.duration_ms)}
          </span>
        </span>
        <span className="mt-2.5 line-clamp-2 text-[15px] font-medium leading-[22px] text-[var(--text-1)] transition-colors group-hover:text-[var(--accent)]">
          {item.title}
        </span>
        <span className="num mt-1.5 flex items-center gap-4 text-[12px] text-[var(--text-3)]">
          <span className="flex items-center gap-1.5" aria-label={`播放 ${formatCount(item.views)}`}>
            <Icon name="play" size={13} />
            {formatCount(item.views)}
          </span>
          <span className="flex items-center gap-1.5" aria-label={`弹幕 ${formatCount(item.danmaku)}`}>
            <Icon name="danmaku" size={13} />
            {formatCount(item.danmaku)}
          </span>
        </span>
      </button>

      <div className="mt-4 flex items-center gap-1 border-t border-[var(--line)] pt-2">
        <button
          type="button"
          onClick={onAuthor}
          className="t press -ml-2 flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
        >
          <Icon name="user" size={15} />
          UP 主页
        </button>
        <button
          type="button"
          onClick={onExternal}
          className="t press flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-[13px] text-[var(--text-2)] hover:bg-[var(--ga0)] hover:text-[var(--accent)]"
        >
          <Icon name="external" size={15} />
          在浏览器打开
        </button>
      </div>
    </article>
  )
}

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
    <div
      id="scroll-main"
      onScroll={(event) => {
        if (!hasMore || loading || error || pending.current) return
        const box = event.currentTarget
        if (box.scrollHeight - box.scrollTop - box.clientHeight < 600) {
          void load(offset, true)
        }
      }}
      className="min-h-0 flex-1 overflow-y-auto bg-[var(--ga0)] pb-10"
    >
      <header className="pt-5">
        <div className={FEED}>
          <PageTitle>动态</PageTitle>
        </div>
      </header>
      <div className={`${FEED} flex flex-col gap-2.5`}>
        {items.map((item) => (
          <DynamicCard
            key={item.id}
            item={item}
            onOpen={() =>
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
            onAuthor={() => navigate({ kind: 'author', name: item.author, mid: item.mid })}
            onExternal={() => {
              void ipc
                .openExternal(`https://www.bilibili.com/video/${item.bvid}`)
                .catch((cause) => toastFailure('打开链接', cause))
            }}
          />
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
              className="t press h-8 rounded-[4px] border border-[var(--line)] bg-[var(--panel)] px-4 text-[13px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-50"
            >
              加载更多
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
