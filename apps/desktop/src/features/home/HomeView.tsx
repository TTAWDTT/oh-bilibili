import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import type { Track } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { TrackGrid } from '../tracks/TrackGrid'
import { usePlayerStore } from '../player/playerStore'

/**
 * 发现页。
 *
 * 推荐接口是全站风控最严的一处，所以这里只取一屏、不做后台预取，
 * 被拒时给明确文案和「换一批」，不假装有内容。
 */
export function HomeView() {
  const navigate = useAppStore((s) => s.navigate)
  const activeKey = usePlayerStore((s) => s.snapshot?.track?.key ?? null)
  const playing = usePlayerStore((s) => s.snapshot?.phase === 'playing')
  const [items, setItems] = useState<Track[]>([])
  const [fresh, setFresh] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (next: number): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const list = await ipc.homeFeed(next)
      setItems(list)
      if (list.length === 0) setError('这次没拿到推荐，换一批试试。')
    } catch (e) {
      setError(toWireError(e).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(1)
  }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-1 pb-3">
        <h2 className="text-[15px] font-medium">发现</h2>
        <button
          type="button"
          onClick={() => {
            const next = fresh + 1
            setFresh(next)
            void load(next)
          }}
          className="t press rounded-[6px] border border-[var(--line)] px-2 py-1 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-alt)]"
        >
          {loading ? '正在换…' : '换一批'}
        </button>
      </div>

      {error ? <p className="px-1 py-6 text-[13px] text-[var(--text-3)]">{error}</p> : null}

      {items.length > 0 ? (
        <TrackGrid
          tracks={items}
          activeKey={activeKey}
          playing={playing}
          extraAction={(track) => (
            <button
              type="button"
              onClick={() => navigate({ kind: 'watch', track })}
              className="t press text-[12px] text-[var(--text-3)] hover:text-[var(--accent)]"
            >
              看视频
            </button>
          )}
        />
      ) : null}
      {loading && items.length === 0 ? (
        <p className="px-1 py-6 text-[13px] text-[var(--text-3)]">正在取推荐…</p>
      ) : null}
    </div>
  )
}
