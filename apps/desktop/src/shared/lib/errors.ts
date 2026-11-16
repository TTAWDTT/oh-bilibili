import type { ErrorClass, WireError } from './contract'

const CLASSES: readonly ErrorClass[] = ['retryable', 'rate_limited', 'needs_login', 'input', 'internal']

function isWireError(value: unknown): value is WireError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { class?: unknown; message?: unknown }
  return typeof candidate.message === 'string' && CLASSES.includes(candidate.class as ErrorClass)
}

/** 命令失败与后台事件共用 WireError；其余任何抛出物都在这里收敛成同一种形状。 */
export function toWireError(cause: unknown): WireError {
  // Rust 侧也会把 reqwest 原文塞进 WireError，签名 URL 一样不能进界面。
  if (isWireError(cause)) return { ...cause, message: explainTransport(cause.message) }
  if (cause instanceof Error) return { class: 'internal', message: explainTransport(cause.message) }
  if (typeof cause === 'string') return { class: 'internal', message: explainTransport(cause) }
  return { class: 'internal', message: '发生了未预期的错误' }
}

/**
 * Tauri 的 IPC 失败会把底层 reqwest 的原文抛上来：
 * 「error sending request for url (https://api.bilibili.com/...?w_rid=...)」。
 * 这条串里带着签名和完整查询参数，既看不懂也不该出现在界面上。
 */
function explainTransport(message: string): string {
  if (/error sending request|error trying to connect|operation timed out|dns error/i.test(message)) {
    return '连不上 B 站，检查一下网络。'
  }
  if (/request was banned/i.test(message)) {
    return '请求太频繁，等一会儿再试。'
  }
  return message
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
