import type { PlayerSnapshot, QueueView } from './contract'
import { clamp } from './format'
import { bool, num, str, strArray } from './mockArgs'
import {
  fail,
  playIndex,
  queueView,
  setPosition,
  snapshot,
  state,
  step,
  trackOf,
} from './mockEngine'

export function playerCommand(command: string, args: Record<string, unknown>): PlayerSnapshot | QueueView {
  switch (command) {
    case 'player_state':
      return snapshot()
    case 'player_play': {
      const key = str(args, 'key')
      trackOf(key)
      let index = state.keys.indexOf(key)
      if (index < 0) {
        state.keys = [key]
        index = 0
      }
      state.index = index
      playIndex(index)
      return snapshot()
    }
    case 'player_play_context': {
      const keys = strArray(args, 'keys')
      if (keys.length === 0) throw fail('input', '播放队列是空的')
      const index = clamp(Math.trunc(num(args, 'index')), 0, keys.length - 1)
      trackOf(keys[index] ?? '')
      state.keys = [...keys]
      playIndex(index)
      return snapshot()
    }
    case 'player_pause':
      if (state.phase === 'playing') state.phase = 'paused'
      return snapshot()
    case 'player_toggle': {
      if (state.phase === 'playing') {
        state.phase = 'paused'
        setPosition(state.position)
      } else if (state.phase === 'ended' || state.phase === 'paused') {
        if (state.phase === 'ended') state.position = 0
        state.phase = 'playing'
        setPosition(state.position)
      } else if (state.index !== null) {
        state.position = 0
        state.phase = 'playing'
        setPosition(0)
      } else {
        throw fail('input', '还没有选择歌曲')
      }
      return snapshot()
    }
    case 'player_next':
      if (state.index === null) throw fail('input', '播放队列是空的')
      step(1, true)
      return snapshot()
    case 'player_prev':
      if (state.index === null) throw fail('input', '播放队列是空的')
      if (state.position > 3000) setPosition(0)
      else step(-1)
      return snapshot()
    case 'player_seek':
      setPosition(num(args, 'position_ms'))
      return snapshot()
    case 'player_replay':
      state.position = 0
      state.phase = 'playing'
      setPosition(0)
      return snapshot()
    case 'player_volume':
      state.volume = clamp(num(args, 'volume'), 0, 1)
      return snapshot()
    case 'player_repeat': {
      const mode = str(args, 'mode')
      if (mode !== 'off' && mode !== 'all' && mode !== 'one') throw fail('input', '循环模式不合法')
      state.repeat = mode
      return snapshot()
    }
    case 'player_speed':
      state.speed = Math.min(2, Math.max(0.5, num(args, 'speed') || 1))
      return snapshot()
    case 'player_shuffle':
      state.shuffle = bool(args, 'on')
      return snapshot()
    case 'queue_state':
      return queueView()
    case 'queue_move': {
      const from = str(args, 'from')
      const to = str(args, 'to')
      const i = state.keys.indexOf(from)
      const j = state.keys.indexOf(to)
      if (i >= 0 && j >= 0 && i !== j) {
        const [moved] = state.keys.splice(i, 1)
        if (moved) state.keys.splice(j, 0, moved)
      }
      return queueView()
    }
    case 'queue_remove': {
      const key = str(args, 'key')
      state.keys = state.keys.filter((k) => k !== key)
      return queueView()
    }
    case 'queue_clear':
      state.keys = []
      return queueView()
    default:
      throw fail('internal', `浏览器 mock 还没有实现 ${command}`)
  }
}
