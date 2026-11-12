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
