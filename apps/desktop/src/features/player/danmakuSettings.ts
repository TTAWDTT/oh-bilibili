import { create } from 'zustand'

export type DanmakuBlockType = 'roll' | 'top' | 'bottom'

/**
 * 弹幕设置。B 站播放器的设置面板也有这几项：开关、透明度、字号、速度、
 * 显示区域，以及屏蔽词/屏蔽类型。存 localStorage，重开还记着上次的选择。
 */
type DanmakuSettings = {
  enabled: boolean
  opacity: number
  size: number
  speed: number
  /** 弹幕可出现的画面高度比例：1/4、1/2、全屏。 */
  area: number
  /** 正文包含任一词就丢掉这条弹幕。存小写，比较时统一 lower-case。 */
  blockWords: string[]
  /** 整个类型都不放：滚动 / 顶部 / 底部。 */
  blockTypes: DanmakuBlockType[]
  setEnabled: (v: boolean) => void
  patch: (part: Partial<Pick<DanmakuSettings, 'opacity' | 'size' | 'speed' | 'area'>>) => void
  setBlockWords: (words: string[]) => void
  toggleBlockType: (type: DanmakuBlockType) => void
}

type Stored = Pick<
  DanmakuSettings,
  'enabled' | 'opacity' | 'size' | 'speed' | 'area' | 'blockWords' | 'blockTypes'
>

const KEY = ['bilimusic', 'danmaku'].join('.')

function load(): Stored {
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
        blockWords: Array.isArray(v.blockWords)
          ? v.blockWords.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
          : [],
        blockTypes: Array.isArray(v.blockTypes)
          ? v.blockTypes.filter(
              (t): t is DanmakuBlockType => t === 'roll' || t === 'top' || t === 'bottom',
            )
          : [],
      }
    }
  } catch {
    // 读不到就用默认值，不值得为它中断播放
  }
  return {
    enabled: true,
    opacity: 0.9,
    size: 13,
    speed: 1,
    area: 1,
    blockWords: [],
    blockTypes: [],
  }
}

function save(state: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 隐私模式下写不进去，忽略
  }
}

function snapshot(state: DanmakuSettings): Stored {
  return {
    enabled: state.enabled,
    opacity: state.opacity,
    size: state.size,
    speed: state.speed,
    area: state.area,
    blockWords: state.blockWords,
    blockTypes: state.blockTypes,
  }
}

const initial = load()

export const useDanmakuSettings = create<DanmakuSettings>((set, get) => ({
  ...initial,
  setEnabled: (enabled) => {
    set({ enabled })
    save({ ...snapshot(get()), enabled })
  },
  patch: (part) => {
    set(part)
    save({ ...snapshot(get()), ...part })
  },
  setBlockWords: (blockWords) => {
    set({ blockWords })
    save({ ...snapshot(get()), blockWords })
  },
  toggleBlockType: (type) => {
    const blockTypes = get().blockTypes.includes(type)
      ? get().blockTypes.filter((t) => t !== type)
      : [...get().blockTypes, type]
    set({ blockTypes })
    save({ ...snapshot(get()), blockTypes })
  },
}))
