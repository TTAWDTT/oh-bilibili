import { create } from 'zustand'

/** 自动连播。B 站默认开着：播完倒计时进下一个，不喜欢可以关掉。 */
const KEY = 'bilimusic.autoplay'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export const useAutoplay = create<{ enabled: boolean; setEnabled: (v: boolean) => void }>((set) => ({
  enabled: load(),
  setEnabled: (enabled) => {
    set({ enabled })
    try {
      localStorage.setItem(KEY, enabled ? '1' : '0')
    } catch {
      // 隐私模式写不进去，忽略
    }
  },
}))

/** 单集循环：B 站播放器那颗循环键，开了之后播完重播当前视频，不切换到下一条。 */
const LOOP_KEY = 'oh-bilibili:watch:loop'

function loadLoop(): boolean {
  try {
    return localStorage.getItem(LOOP_KEY) === '1'
  } catch {
    return false
  }
}

export const useLoopOne = create<{ enabled: boolean; setEnabled: (v: boolean) => void }>((set) => ({
  enabled: loadLoop(),
  setEnabled: (enabled) => {
    set({ enabled })
    try {
      localStorage.setItem(LOOP_KEY, enabled ? '1' : '0')
    } catch {
      // 隐私模式写不进去，只影响这次会话
    }
  },
}))
