import type { WireError } from '../shared/lib/contract'
import { describeWireError, toWireError } from '../shared/lib/errors'
import type { ToastTone } from './appStore'
import { useAppStore } from './appStore'

const TONE: Record<WireError['class'], ToastTone> = {
  retryable: 'warn',
  rate_limited: 'warn',
  needs_login: 'info',
  input: 'warn',
  internal: 'error',
}

export function toastWire(error: WireError, op: string): void {
  const { title, detail } = describeWireError(error)
  useAppStore.getState().pushToast(TONE[error.class], title, `${op}：${detail}`)
}

export function toastFailure(op: string, cause: unknown): void {
  toastWire(toWireError(cause), op)
}

export function toastDone(title: string, detail: string | null = null): void {
  useAppStore.getState().pushToast('success', title, detail)
}
