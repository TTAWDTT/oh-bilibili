import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { favCovers, type FavFolder } from '../../shared/lib/ipc'
import { thumbWide } from '../../shared/lib/thumb'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
import './favorite-directory.css'

type DirectoryProps = {
  folders: FavFolder[]
  pickedId: number | null
  onPick: (folder: FavFolder) => void
  compact: boolean
}

export function FavoriteDirectory({ folders, pickedId, onPick, compact }: DirectoryProps) {
  const list = useRef<HTMLDivElement>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  useLayoutEffect(() => {
    const strip = list.current
    if (!compact || !strip) return
    const update = () => {
      setCanGoBack(strip.scrollLeft > 1)
      setCanGoForward(strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    strip.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      strip.removeEventListener('scroll', update)
    }
  }, [compact, folders.length])

  useLayoutEffect(() => {
    const strip = list.current
    const selected = strip?.querySelector('[aria-current="true"]')
    if (!compact || !strip || !selected) return
    // 只移动目录的横轴。由视频返回时不能把正文也滚回页首。
    const frame = strip.getBoundingClientRect()
    const card = selected.getBoundingClientRect()
    if (card.left < frame.left) strip.scrollBy({ left: card.left - frame.left, behavior: 'instant' })
    else if (card.right > frame.right) strip.scrollBy({ left: card.right - frame.right, behavior: 'instant' })
  }, [compact, pickedId])

  const turnPage = (direction: number) => {
    const strip = list.current!
    const cardWidth = strip.firstElementChild!.getBoundingClientRect().width
    const step = cardWidth + parseFloat(getComputedStyle(strip).columnGap)
    strip.scrollBy({ left: direction * Math.max(1, Math.floor(strip.clientWidth / step)) * step })
  }

  const focusFolder = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const strip = list.current!
    let next = index
    switch (event.key) {
      case 'ArrowRight': next++; break
      case 'ArrowLeft': next--; break
      case 'ArrowDown':
      case 'ArrowUp': {
        const columns = compact ? 1 : getComputedStyle(strip).gridTemplateColumns.split(' ').length
        next += event.key === 'ArrowDown' ? columns : -columns
        break
      }
      case 'Home': next = 0; break
      case 'End': next = folders.length - 1; break
      default: return
    }
    event.preventDefault()
    const target = strip.children[Math.max(0, Math.min(folders.length - 1, next))] as HTMLButtonElement
    target.focus()
  }

  return (
    <section aria-label="收藏夹目录" className="favorite-directory">
      <PageTitle extra={`${folders.length} 个`} action={compact && (canGoBack || canGoForward) && <>
        <button type="button" className="favorite-page-arrow" aria-label="上一组收藏夹" disabled={!canGoBack} onClick={() => turnPage(-1)}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <button type="button" className="favorite-page-arrow" aria-label="下一组收藏夹" disabled={!canGoForward} onClick={() => turnPage(1)}>
          <Icon name="chevronRight" size={16} />
        </button>
      </>}>
        收藏夹
      </PageTitle>
      <div ref={list} className={`favorite-folder-list ${compact ? 'favorite-folder-strip no-scrollbar' : 'favorite-folder-grid'}`}>
        {folders.map((folder, index) => (
          <button key={folder.id} type="button" data-fav-folder={folder.id} className="favorite-folder"
            aria-current={pickedId === folder.id ? 'true' : undefined}
            onClick={() => onPick(folder)} onKeyDown={event => focusFolder(event, index)}>
            <FolderCover folder={folder} />
            <span className="favorite-folder-name" title={folder.title}>{folder.title}</span>
            <span className="favorite-folder-count num">{folder.count} 个视频</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// 每条队列串行补封面，确保目录有许多缺图的收藏夹时也只并发三个请求。
const coverRequests = Array.from({ length: 3 }, () => Promise.resolve())

export function FolderCover({ folder }: { folder: FavFolder }) {
  const { id, count, cover } = folder
  const [preview, setPreview] = useState<{ count: number; cover: string } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  useEffect(() => {
    if (cover || count === 0) return
    let current = true
    const previous = coverRequests.shift()!
    coverRequests.push(previous.then(async () => {
      if (!current) return
      const [first] = await favCovers(id, 1).catch(() => [])
      if (current && first) setPreview({ count, cover: first })
    }))
    return () => { current = false }
  }, [id, count, cover])

  const previewCover = preview?.count === count ? preview.cover : null
  const src = count > 0 ? thumbWide(cover || previewCover, 480) : null
  return (
    <span className="favorite-folder-cover" aria-hidden="true">
      <span className="favorite-folder-picture">
        {src && src !== broken ? (
          <img className="favorite-folder-image" src={src} alt="" draggable={false} loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onError={() => setBroken(src)} />
        ) : <Icon name="favoriteFolder" size={38} />}
      </span>
    </span>
  )
}
