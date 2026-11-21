import { create } from 'zustand'
import type { PlayerSnapshot, QueueView, RepeatMode, Track } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { syncPlayhead } from '../../shared/lib/playhead'
import { setLevel } from '../../shared/lib/level'
import { toastFailure } from '../../app/notice'

/** 只认最后一次发起的命令，迟到的响应不能覆盖用户更晚的操作。 */
let ticket = 0
let initPromise: Promise<void> | null = null

type PlayerStore = {
  /** 轻量进度切片：只有明确订阅它的组件才会因进度变化重渲染。 */
  progress: { position_ms: number; duration_ms: number }
  setProgress: (p: { position_ms: number; duration_ms: number }) => void
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
  setSpeed: (speed: number) => Promise<void>
  cycleRepeat: () => Promise<void>
  setShuffle: (on: boolean) => void
  moveInQueue: (from: string, to: string) => Promise<void>
  removeFromQueue: (key: string) => Promise<void>
  clearQueue: () => Promise<void>
  undoClearQueue: () => Promise<void>
  applyProgress: (positionMs: number, durationMs: number, level?: number, sentAtMs?: number) => void
  applySnapshot: (snapshot: PlayerSnapshot) => void
  applyTrack: (track: Track) => void
  applyBuffering: (track: Track) => void
  applyStopped: () => void
}

/** 上次的倍速。引擎每次启动回到 1.0，所以启动时补一次。 */
const SPEED_KEY = 'bilimusic.speed'
/** 上次的音量。引擎重新启动时也把用户的选择补回去。 */
const VOLUME_KEY = 'bilimusic.volume'

function loadSpeed(): number {
  try {
    return Number(localStorage.getItem(SPEED_KEY) ?? 1) || 1
  } catch {
    return 1
  }
}

function loadVolume(): number | null {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw === null) return null
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    return Math.min(1, Math.max(0, value))
  } catch {
    return null
  }
}

export const usePlayerStore = create<PlayerStore>()((set, get) => {
  const apply = (next: PlayerSnapshot): void => {
    // 进度与快照一起换。换曲时只更新快照会让 progress 停在上一条的位置，
    // 观看页拿它判断声音是否真的起播，就会误判。
    set({ snapshot: next, progress: { position_ms: next.position_ms, duration_ms: next.duration_ms } })
    syncPlayhead(next.position_ms, next.phase === 'playing', next.duration_ms)
  }

  const run = async (op: string, task: () => Promise<PlayerSnapshot>): Promise<boolean> => {
    const current = ++ticket
    try {
      const next = await task()
      if (current === ticket) {
        apply(next)
        return true
      }
    } catch (cause) {
      if (current === ticket) toastFailure(op, cause)
    }
    return false
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
  progress: { position_ms: 0, duration_ms: 0 },
  setProgress: (p) => set({ progress: p }),
    queue: null,
    init: () => {
      if (initPromise) return initPromise
      initPromise = (async () => {
        try {
          const [snapshot, queue] = await Promise.all([ipc.playerState(), ipc.queueState()])
          apply(snapshot)
          set({ queue })
          // 引擎重启后倍速回到 1.0；把上次选的补回去（快照已在手，不用再等一次往返）。
          const saved = loadSpeed()
          if (saved !== 1 && Math.abs((snapshot.speed ?? 1) - saved) > 0.001) {
            void ipc.playerSetSpeed(saved).then(apply).catch(() => {})
          }
          const savedVolume = loadVolume()
          if (savedVolume !== null && Math.abs((snapshot.volume ?? 0.7) - savedVolume) > 0.001) {
            void ipc.playerVolume(savedVolume).then(apply).catch(() => {})
          }
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
    setSpeed: async (speed) => {
      try {
        apply(await ipc.playerSetSpeed(speed))
        // 倍速跟人走，不跟这条视频走：B 站也记住这个偏好。
        try {
          localStorage.setItem(SPEED_KEY, String(speed))
        } catch {
          // 隐私模式写不进去，只影响这次会话
        }
      } catch {
        // 倍速失败不打断播放
      }
    },
    setVolume: async (volume) => {
      const value = Math.min(1, Math.max(0, volume))
      const current = get().snapshot
      if (current) apply({ ...current, volume: value })
      if (await run('调整音量', () => ipc.playerVolume(value))) {
        try {
          localStorage.setItem(VOLUME_KEY, String(value))
        } catch {
          // 隐私模式写不进去，只影响这次会话
        }
      }
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
    moveInQueue: async (from, to) => {
      // 乐观更新：先动本地顺序，接口失败再回滚，拖拽不会卡顿。
      const current = get().queue
      if (!current) return
      const items = [...current.items]
      const fromIdx = items.findIndex((t) => t.key === from)
      const toIdx = items.findIndex((t) => t.key === to)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
      const moved = items.splice(fromIdx, 1)[0]
      if (!moved) return
      items.splice(toIdx, 0, moved)
      set({ queue: { ...current, items } })
      try {
        set({ queue: await ipc.queueMove(from, to) })
      } catch {
        set({ queue: current })
      }
    },
    removeFromQueue: async (key) => {
      try {
        set({ queue: await ipc.queueRemove(key) })
      } catch {
        // 移除失败就保持原样，界面不动比乱动好
      }
    },
    clearQueue: async () => {
      try {
        set({ queue: await ipc.queueClear() })
      } catch {
        // 同上
      }
    },
    undoClearQueue: async () => {
      try {
        set({ queue: await ipc.queueUndoClear() })
      } catch (cause) {
        toastFailure('撤销清空', cause)
      }
    },
    applyProgress: (positionMs, durationMs, level = 0, sentAtMs) => {
      const current = get().snapshot
      if (!current) return
      setLevel(level)
      // 位置只放在 anchor 里，不写回 snapshot：写回会让所有订阅 snapshot 的
      // 组件每秒重渲染 5 次，而它们真正需要的只有「当前是第几行」。
      syncPlayhead(positionMs, current.phase === 'playing', durationMs, sentAtMs)
      set({ progress: { position_ms: positionMs, duration_ms: durationMs } })
    },
    applySnapshot: (snapshot) => apply(snapshot),
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

/**
 * 这次会话在不在放。全应用只在这里定义「在放」。
 *
 * 早先每个组件各写一遍 `snapshot?.phase === 'playing'`，语义靠各自理解；
 * 「会话是否活着」（播放条要不要出现）和「是否正在出声」（动画要不要跑）
 * 是两件事，分开给名字，读代码的人不用再猜。
 */
export function useIsPlaying(): boolean {
  return usePlayerStore((state) => state.snapshot?.phase === 'playing')
}

/** 会话是否活着：有加载、在放、暂停、播完都算，没有会话（idle）就不算。 */
export function useHasSession(): boolean {
  return usePlayerStore((state) => {
    const phase = state.snapshot?.phase ?? 'idle'
    return phase !== 'idle'
  })
}

/** 这次会话是不是「听」模式。看视频时不跑音频动画，也不显示播放条。 */
export function useIsListening(): boolean {
  return usePlayerStore((state) => (state.snapshot?.mode ?? 'listen') === 'listen')
}
