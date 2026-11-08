import { listen } from '@tauri-apps/api/event'
import type { AppEvent } from './contract'
import { EVENT_CHANNEL } from './contract'
import { mockSubscribe } from './mock'
import { isTauri } from './runtime'

/** 事件流在 Tauri 里走原生通道，在浏览器里走 mock 的同步广播，调用方只看见一个退订函数。 */
export async function subscribeEvents(onEvent: (event: AppEvent) => void): Promise<() => void> {
  if (!isTauri) return mockSubscribe(onEvent)
  return listen<AppEvent>(EVENT_CHANNEL, (event) => onEvent(event.payload))
}
