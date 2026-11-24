import { useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { toWireError } from '../../shared/lib/errors'
import { spaceMedalWall, type WallMedal } from '../../shared/lib/ipc'

export function MedalWall({ mid }: { mid: number }) {
  const [open, setOpen] = useState(false)
  const [medals, setMedals] = useState<WallMedal[]>()
  const [error, setError] = useState<ReturnType<typeof toWireError>>()
  async function load() {
    setError(undefined)
    try { setMedals(await spaceMedalWall(mid)) }
    catch (cause) { setError(toWireError(cause)) }
  }
  return <div>
    <button type="button" aria-expanded={open} className="text-[var(--accent)] hover:underline"
      onClick={() => { setOpen(!open); if (!open && !medals) void load() }}>粉丝勋章墙</button>
    {open && (medals ? medals.length ? <ul className="mt-1 flex max-h-44 flex-wrap gap-2 overflow-auto" aria-label="粉丝勋章">
      {medals.map((medal, index) => <li key={index} className="rounded border border-[var(--line)] px-2 py-1">
        {medal.name} {medal.level}{medal.creator && <span className="ml-1 text-[var(--text-3)]">{medal.creator}</span>}
      </li>)}
    </ul> : <p>暂无公开勋章</p> : error ? <div role="status">
      {error.message} {error.class === 'needs_login'
        ? <button type="button" className="text-[var(--accent)]" onClick={() => useAppStore.getState().setAuthOpen(true)}>登录</button>
        : <button type="button" className="text-[var(--accent)]" onClick={() => void load()}>重试</button>}
    </div> : <p role="status">正在读取勋章墙…</p>)}
  </div>
}
