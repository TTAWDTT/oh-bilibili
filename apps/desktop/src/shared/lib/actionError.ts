import { useAppStore } from '../../app/appStore'
import { toastFailure } from '../../app/notice'
import { toWireError } from './errors'

/**
 * 需要登录的操作失败时的统一处理。
 *
 * B 站的做法是直接弹登录框，而不是丢一句「需要登录」让人自己去找入口。
 * 其他错误照常走 toast。
 */
export function reportActionError(label: string, cause: unknown): void {
  const error = toWireError(cause)
  if (error.class === 'needs_login') {
    useAppStore.getState().setAuthOpen(true)
    return
  }
  toastFailure(label, error)
}
