import { create } from 'zustand'

/**
 * 弹幕设置。B 站播放器的设置面板也是这四项：开关、透明度、字号、速度。
 * 存 localStorage，重开还记着你上次的选择。
 */
type DanmakuSettings = {
  enabled: boolean
  opacity: number
  size: number
  speed: number
  /** 弹幕可出现的画面高度比例：1/4、1/2、全屏。 */
  area: number
  setEnabled: (v: boolean) => void
  patch: (part: Partial<Pick<DanmakuSettings, 'opacity' | 'size' | 'speed' | 'area'>>) => void
}

const KEY = 'bilimusic.danmaku'

function load(): Pick<DanmakuSettings, 'enabled' | 'opacity' | 'size' | 'speed' | 'area'> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<DanmakuSettings>
      return {
        enabled: v.enabled ?? true,
        opacity: v.opacity ?? 0.9,
        size: v.size ?? 13,
        speed: v.speed ?? 1,
        area: v.area === 0.25 || v.area === 0.5 ? v.area : 1,
      }
    }
  } catch {
    // 读不到就用默认值，不值得为它中断播放
  }
  return { enabled: true, opacity: 0.9, size: 13, speed: 1, area: 1 }
}

function save(
  state: Pick<DanmakuSettings, 'enabled' | 'opacity' | 'size' | 'speed' | 'area'>,
): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 隐私模式下写不进去，忽略
  }
}

const initial = load()

export const useDanmakuSettings = create<DanmakuSettings>((set, get) => ({
  ...initial,
  setEnabled: (enabled) => {
    set({ enabled })
    save({ ...get(), enabled })
  },
  patch: (part) => {
    set(part)
    save({ ...get(), ...part })
  },
}))
