import { useEffect } from 'react'
import { subscribeEvents } from '../shared/lib/events'
import { usePlayerStore } from '../features/player/playerStore'
import { useLibraryStore } from '../features/library/libraryStore'
import { useDownloadsStore } from '../features/downloads/downloadsStore'
import { useAuthStore } from '../features/auth/authStore'
import { toastWire } from './notice'

/** 一次性把启动时的快照拉齐，并把 bilimusic://event 分流到各个 store。 */
export function useBootstrap(): void {
  useEffect(() => {
    void usePlayerStore.getState().init()
    void useLibraryStore.getState().load()
    void useDownloadsStore.getState().load()
    void useAuthStore.getState().load()

    let dispose: (() => void) | null = null
    let cancelled = false

    void subscribeEvents((event) => {
      const player = usePlayerStore.getState()
      switch (event.type) {
        case 'progress':
          player.applyProgress(event.position_ms, event.duration_ms)
          break
        case 'now_playing':
          player.applyTrack(event.track)
          break
        case 'buffering':
          player.applyBuffering(event.track)
          break
        case 'stopped':
          player.applyStopped()
          break
        case 'auth_changed':
          useAuthStore.getState().apply(event.auth)
          break
        case 'notice':
          toastWire(event.error, event.op)
          break
        case 'download':
          useDownloadsStore.getState().upsert(event.view)
          break
        case 'library_changed':
          useLibraryStore.getState().refresh()
          break
      }
    }).then((stop) => {
      if (cancelled) stop()
      else dispose = stop
    })

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])
}
