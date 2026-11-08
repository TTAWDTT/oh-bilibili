import { create } from 'zustand'

/**
 * 搜索历史。B 站搜索框点进去会显示最近搜过的词。
 *
 * 存在 localStorage，最多 12 条，重复的词提到最前。
 */
const KEY = 'bilimusic.searchHistory'
const MAX = 12

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

function persist(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // 隐私模式写不进去，忽略
  }
}

export const useSearchHistory = create<{
  items: string[]
  push: (keyword: string) => void
  clear: () => void
}>((set, get) => ({
  items: load(),
  push: (keyword) => {
    const word = keyword.trim()
    if (!word) return
    const next = [word, ...get().items.filter((w) => w !== word)].slice(0, MAX)
    persist(next)
    set({ items: next })
  },
  clear: () => {
    persist([])
    set({ items: [] })
  },
}))
