import type { ErrorClass, WireError } from './contract'

const CLASSES: readonly ErrorClass[] = ['retryable', 'rate_limited', 'needs_login', 'input', 'internal']

function isWireError(value: unknown): value is WireError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { class?: unknown; message?: unknown }
  return typeof candidate.message === 'string' && CLASSES.includes(candidate.class as ErrorClass)
}

/** 命令失败与后台事件共用 WireError；其余任何抛出物都在这里收敛成同一种形状。 */
export function toWireError(cause: unknown): WireError {
  if (isWireError(cause)) return cause
  if (cause instanceof Error) return { class: 'internal', message: cause.message }
  if (typeof cause === 'string') return { class: 'internal', message: cause }
  return { class: 'internal', message: '发生了未预期的错误' }
}

const HEADLINE: Record<ErrorClass, string> = {
  retryable: '可以再试一次',
  rate_limited: '请求被限流',
  needs_login: '需要登录',
  input: '操作没有完成',
  internal: '出了点问题',
}

export function describeWireError(error: WireError): { title: string; detail: string } {
  const retry =
    error.class === 'rate_limited' && error.retry_after_ms !== undefined
      ? `（${Math.ceil(error.retry_after_ms / 1000)} 秒后重试）`
      : ''
  return { title: HEADLINE[error.class], detail: `${error.message}${retry}` }
}
