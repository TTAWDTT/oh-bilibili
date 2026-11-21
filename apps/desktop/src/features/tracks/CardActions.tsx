import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { DownloadButton } from '../downloads/DownloadButton'
import { useReactionStore } from '../reactions/reactionStore'
import { Icon } from '../../shared/ui/Icon'
import { BiliCoin, BiliStar, BiliThumb } from '../../shared/ui/BiliTri'
import type { Track } from '../../shared/lib/contract'

function MenuItem({
  icon,
  label,
  tone,
  disabled,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  tone?: string | undefined
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-white/85 hover:bg-white/10 disabled:cursor-default disabled:opacity-45"
    >
      <span className={tone ?? 'text-white/70'}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * 卡片封面上的动作排：听、稍后再看和更多。
 *
 * 点赞、投币、收藏、下载收进「更多」，免得常用入口被六个图标摊平。
 * 这一条压在封面图上的黑色渐变里，所以用白字；只在 hover 或键盘聚焦时出现。
 */
export function CardActions({
  track,
  onListen,
  onCoin,
  onFav,
  onLater,
  extraAction,
}: {
  track: Track
  onListen: () => void
  onCoin: () => void
  onFav: (faved: boolean) => void
  onLater: () => void
  extraAction?: React.ReactNode
}) {
  const liked = useReactionStore((st) => st.liked[track.key] ?? false)
  const faved = useReactionStore((st) => st.faved[track.key] ?? false)
  const coins = useReactionStore((st) => st.coins[track.key] ?? 0)
  const toggleLike = useReactionStore((st) => st.toggleLike)
  const hydrate = useReactionStore((st) => st.hydrate)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)
  const moreButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!moreOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (moreRef.current?.contains(event.target as Node)) return
      setMoreOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [moreOpen])

  return (
    <div
      data-card-actions
      className={[
        'absolute inset-x-0 top-0 flex items-center justify-end gap-1 rounded-t-[8px] bg-gradient-to-b from-black/75 via-black/40 to-transparent px-1.5 pb-4 pt-1.5 transition-opacity duration-150',
        moreOpen
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
      ].join(' ')}
      // 互动状态只在这排动作真正被用到时查。整页/预取时逐条查 relation，
      // 会把串行闸门占满，翻页反而被拖慢。
      onPointerEnter={() => void hydrate([track.key]).catch(() => {})}
      onFocus={() => void hydrate([track.key]).catch(() => {})}
    >
      <button
        type="button"
        aria-label={`听 ${track.title}`}
        title="只听声音"
        onClick={onListen}
        className="bili-icon-btn flex h-6 items-center gap-1 rounded-[4px] bg-[var(--accent)] px-2 text-[11px] font-medium text-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] hover:brightness-110"
      >
        <Icon name="headphones" size={12} />听
      </button>
      <button
        type="button"
        aria-label="稍后再看"
        title="稍后再看"
        onClick={onLater}
        className="bili-icon-btn flex h-6 items-center gap-1 rounded-[4px] bg-black/55 px-2 text-[11px] text-white/90 hover:bg-white/20 hover:text-white"
      >
        <Icon name="watchLater" size={12} />稍后再看
      </button>
      <div
        ref={moreRef}
        className="relative"
        onBlur={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && moreRef.current?.contains(next)) return
          setMoreOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setMoreOpen(false)
          moreButton.current?.focus()
        }}
      >
        <button
          ref={moreButton}
          type="button"
          aria-label="更多"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          onKeyDown={(event) => {
            // 原生按钮只在真实按键序列里合成 click；这里显式接管，Enter/空格都能开菜单。
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setMoreOpen((open) => !open)
          }}
          className="bili-icon-btn flex h-6 items-center rounded-[4px] bg-black/55 px-2 text-[11px] text-white/90 hover:bg-white/20 hover:text-white"
        >
          更多
        </button>
        {moreOpen ? (
          <div
            role="menu"
            aria-label="更多操作"
            className="absolute right-0 top-7 z-30 w-[136px] overflow-hidden rounded-[6px] border border-white/15 bg-black/90 py-1 shadow-[0_10px_28px_rgba(0,0,0,0.5)] backdrop-blur"
          >
            <MenuItem
              icon={<BiliThumb size={13} filled={liked} />}
              tone={liked ? 'text-[var(--accent)]' : undefined}
              label={liked ? '取消点赞' : '点赞'}
              onSelect={() => {
                setMoreOpen(false)
                void toggleLike(track)
              }}
            />
            <MenuItem
              icon={<BiliCoin size={13} />}
              tone={coins > 0 ? 'text-[var(--coin)]' : undefined}
              label={coins >= 2 ? '已投满 2 枚' : coins > 0 ? `已投 ${coins} 枚币` : '投币'}
              disabled={coins >= 2}
              onSelect={() => {
                setMoreOpen(false)
                onCoin()
              }}
            />
            <MenuItem
              icon={<BiliStar size={13} filled={faved} />}
              tone={faved ? 'text-[var(--coin)]' : undefined}
              label={faved ? '取消收藏' : '收藏'}
              onSelect={() => {
                setMoreOpen(false)
                onFav(faved)
              }}
            />
            <DownloadButton
              trackKey={track.key}
              size={13}
              variant="menu"
              onInvoke={() => setMoreOpen(false)}
            />
            {extraAction ? <div className="border-t border-white/10">{extraAction}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
