import { create } from 'zustand'

/**
 * 刚发出去、还没进服务器列表的弹幕。
 *
 * B 站发完弹幕立刻上屏，不用等下一次拉取。服务端列表有延迟，
 * 所以本机先记着，显示时和拉回来的数据合并。
 */
export type SentLine = { at: number; text: string; color: string }

type Store = {
  byTrack: Record<string, SentLine[]>
  append: (trackKey: string, line: SentLine) => void
}

export const useSentDanmaku = create<Store>()((set) => ({
  byTrack: {},
  append: (trackKey, line) =>
    set((state) => ({
      byTrack: {
        ...state.byTrack,
        [trackKey]: [...(state.byTrack[trackKey] ?? []), line],
      },
    })),
}))
