import { invoke } from '@tauri-apps/api/core'

export type Health = {
  ok: boolean
  version: string
  engine: string
  platform: string
}

/** 在浏览器里跑 `npm run web` 时没有 Tauri 运行时，降级成本地假数据，方便调界面。 */
const hasTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function health(): Promise<Health> {
  if (!hasTauri) {
    return { ok: true, version: '0.1.0', engine: 'browser-preview', platform: 'web' }
  }
  return invoke<Health>('health')
}
