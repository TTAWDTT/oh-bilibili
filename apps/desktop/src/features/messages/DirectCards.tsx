import { useAppStore } from '../../app/appStore'
import { parseWatchUrl } from '../watch/watchUrl'
import { toastFailure } from '../../app/notice'
import { openExternal, type DirectCard } from '../../shared/lib/ipc'
import { Icon } from '../../shared/ui/Icon'

export function DirectCards({ cards, messageId }: { cards: DirectCard[]; messageId: string }) {
  const navigate = useAppStore((state) => state.navigate)
  return cards.map((card, index) => {
    const contents = <>
      {card.cover && <img src={card.cover} alt="" loading="lazy" referrerPolicy="no-referrer"
        className="h-[58px] w-[84px] shrink-0 rounded-[4px] object-cover" />}
      <span className="min-w-0 flex-1">
        <strong className="line-clamp-2 break-words text-[14px] font-medium text-[var(--text-1)]">{card.title}</strong>
        {card.description && <span className="mt-0.5 line-clamp-2 break-words text-xs text-[var(--text-2)]">{card.description}</span>}
        {card.author && <span className="mt-0.5 block truncate text-xs text-[var(--text-3)]">{card.author}</span>}
      </span>
    </>
    const classes = 'flex w-[300px] max-w-[92%] items-center gap-2 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] p-2 text-left'
    const url = card.url
    const video = url ? parseWatchUrl(url) : null
    const focus = `direct-card:${messageId}:${index}`
    const follow = () => {
      if (video) {
        navigate({ kind: 'watch',
          ...(video.page == null ? {} : { page: video.page }),
          ...(video.atMs == null ? {} : { atMs: video.atMs }),
          track: { key: video.bvid, title: card.title, artist: card.author ?? '', cover: card.cover, duration_ms: null },
        }, undefined, focus)
      } else if (url) {
        void openExternal(url).catch((cause) => toastFailure('打开消息卡片', cause))
      }
    }
    return url ? <button type="button" data-direct-card data-focus-id={focus} key={index}
      title={video ? `观看 ${card.title}` : url} onClick={follow}
      className={`${classes} hover:border-[var(--accent)]`}>{contents}<Icon name={video ? 'play' : 'external'} size={12} /></button>
      : <div data-direct-card key={index} className={classes}>{contents}</div>
  })
}
