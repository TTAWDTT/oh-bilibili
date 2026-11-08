// 响度单独走一条订阅，10Hz 更新不进 zustand：
// 一个数字的变化不该让整棵组件树重渲染。

type Listener = (level: number) => void

const listeners = new Set<Listener>()
let current = 0

export function setLevel(next: number): void {
  current = next
  for (const fn of listeners) fn(next)
}

export function getLevel(): number {
  return current
}

export function subscribeLevel(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
