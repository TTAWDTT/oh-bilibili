import { create } from 'zustand'
import type { PlayerSnapshot, QueueView, RepeatMode, Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { syncPlayhead } from '../../shared/lib/playhead'
import { toastFailure } from '../../app/notice'

/** 只认最后一次发起的命令，迟到的响应不能覆盖用户更晚的操作。 */
let ticket = 0
let initPromise: Promise<void> | null = null

type PlayerStore = {
  snapshot: PlayerSnapshot | null
  queue: QueueView | null
  init: () => Promise<void>
  refreshQueue: () => Promise<void>
  play: (key: string) => Promise<void>
  playContext: (keys: string[], index: number) => Promise<void>
  toggle: () => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
  seek: (positionMs: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  cycleRepeat: () => Promise<void>
  setShuffle: (on: boolean) => void
  applyProgress: (positionMs: number, durationMs: number) => void
  applyTrack: (track: Track) => void
  applyBuffering: (track: Track) => void
  applyStopped: () => void
}

export const usePlayerStore = create<PlayerStore>()((set, get) => {
  const apply = (next: PlayerSnapshot): void => {
    set({ snapshot: next })
    syncPlayhead(next.position_ms, next.phase === 'playing', next.duration_ms)
  }

  const run = async (op: string, task: () => Promise<PlayerSnapshot>): Promise<void> => {
    const current = ++ticket
    try {
      const next = await task()
      if (current === ticket) apply(next)
    } catch (cause) {
      if (current === ticket) toastFailure(op, cause)
    }
  }

  const refreshQueue = async (): Promise<void> => {
    try {
      set({ queue: await ipc.queueState() })
    } catch {
      // 队列只是播放状态的投影，读失败不该影响用户按下一次播放。
    }
  }

  return {
    snapshot: null,
    queue: null,
    init: () => {
      if (initPromise) return initPromise
      initPromise = (async () => {
        try {
          const [snapshot, queue] = await Promise.all([ipc.playerState(), ipc.queueState()])
          apply(snapshot)
          set({ queue })
        } catch (cause) {
          initPromise = null
          toastFailure('读取播放状态', cause)
        }
      })()
      return initPromise
    },
    refreshQueue,
    play: async (key) => {
      await run('播放', () => ipc.playerPlay(key))
      await refreshQueue()
    },
    playContext: async (keys, index) => {
      await run('开始播放', () => ipc.playerPlayContext(keys, index))
      await refreshQueue()
    },
    toggle: async () => {
      await run('播放控制', () => ipc.playerToggle())
    },
    next: async () => {
      await run('下一首', () => ipc.playerNext())
      await refreshQueue()
    },
    prev: async () => {
      await run('上一首', () => ipc.playerPrev())
      await refreshQueue()
    },
    seek: async (positionMs) => {
      await run('调整进度', () => ipc.playerSeek(positionMs))
    },
    setVolume: async (volume) => {
      const current = get().snapshot
      if (current) apply({ ...current, volume })
      await run('调整音量', () => ipc.playerVolume(volume))
    },
    cycleRepeat: async () => {
      const order: readonly RepeatMode[] = ['off', 'all', 'one']
      const current = get().snapshot?.repeat ?? 'off'
      const next = order[(order.indexOf(current) + 1) % order.length] ?? 'off'
      await run('循环模式', () => ipc.playerRepeat(next))
    },
    setShuffle: (on) => {
      void run('随机播放', () => ipc.playerShuffle(on))
    },
    applyProgress: (positionMs, durationMs) => {
      const current = get().snapshot
      if (!current) return
      apply({ ...current, position_ms: positionMs, duration_ms: durationMs })
    },
    applyTrack: (track) => {
      const current = get().snapshot
      if (!current) {
        void get().init()
        return
      }
      apply({ ...current, track, duration_ms: track.duration_ms ?? current.duration_ms })
      void refreshQueue()
    },
    applyBuffering: (track) => {
      const current = get().snapshot
      if (!current) return
      apply({ ...current, track, phase: 'loading' })
    },
    applyStopped: () => {
      const current = get().snapshot
      if (!current) return
      apply({ ...current, phase: 'ended', position_ms: current.duration_ms })
    },
  }
})
