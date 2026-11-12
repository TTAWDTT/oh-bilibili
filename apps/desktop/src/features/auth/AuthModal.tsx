import { Mascot2233 } from '../../shared/ui/Mascot2233'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QrChallenge, QrStatus, WireError } from '../../shared/lib/contract'
import { toWireError } from '../../shared/lib/errors'
import { formatTime } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { isTauri } from '../../shared/lib/runtime'
import { useAppStore } from '../../app/appStore'
import { toastDone } from '../../app/notice'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { Modal } from '../../shared/ui/Modal'
import { Skeleton } from '../../shared/ui/Skeleton'
import { useAuthStore } from './authStore'
import { QrPanel } from './QrPanel'

type Phase = QrStatus['state'] | 'loading' | 'error'

export function AuthModal() {
  const open = useAppStore((state) => state.authOpen)
  const setOpen = useAppStore((state) => state.setAuthOpen)
  const auth = useAuthStore((state) => state.auth)
  const [challenge, setChallenge] = useState<QrChallenge | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<WireError | null>(null)
  const [issuedAt, setIssuedAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const runId = useRef(0)
  const loggedIn = auth?.logged_in === true

  const start = useCallback(async (): Promise<void> => {
    const ticket = ++runId.current
    setPhase('loading')
    setError(null)
    setChallenge(null)
    try {
      const next = await ipc.authQrCode()
      if (runId.current !== ticket) return
      setChallenge(next)
      setIssuedAt(Date.now())
      setNow(Date.now())
      setPhase('waiting')
    } catch (cause) {
      if (runId.current !== ticket) return
      setError(toWireError(cause))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (!open || loggedIn) return
    void start()
  }, [open, loggedIn, start])

  useEffect(() => {
    if (!open || !challenge) return
    if (phase !== 'waiting' && phase !== 'scanned') return
    const timer = window.setInterval(() => {
      void ipc
        .authPoll(challenge.key)
        .then(async (result) => {
          setPhase(result.state)
          if (result.state === 'confirmed') {
            try {
              useAuthStore.getState().apply(await ipc.authStatus())
            } catch {
              if (result.auth) useAuthStore.getState().apply(result.auth)
            }
            toastDone('已登录', '喜欢与收藏现在会同步到 B 站。')
            window.setTimeout(() => useAppStore.getState().setAuthOpen(false), 1200)
          }
        })
        .catch((cause: unknown) => {
          setError(toWireError(cause))
          setPhase('error')
        })
    }, 1600)
    return () => window.clearInterval(timer)
  }, [open, challenge, phase])

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [open])

  const remaining = challenge ? Math.max(0, challenge.expires_in_ms - (now - issuedAt)) : 0

  useEffect(() => {
    if (!challenge || remaining > 0) return
    if (phase === 'waiting' || phase === 'scanned') setPhase('expired')
  }, [challenge, remaining, phase])

  const panelState: QrStatus['state'] = phase === 'loading' || phase === 'error' ? 'waiting' : phase

  return (
    <Modal
      open={open}
      title={loggedIn ? '账号' : '扫码登录'}
      description={
        loggedIn ? null : '用手机 B 站扫码，或把登录链接复制到手机上打开。凭据只存本机，不上传。'
      }
      onClose={() => setOpen(false)}
    >
      {!loggedIn ? (
        <div className="flex justify-center pb-2">
          <Mascot2233 height={168} />
        </div>
      ) : null}

      {loggedIn && auth?.user ? (
        <div className="flex items-center gap-4 border-b border-hairline pb-5">
          {auth.user.avatar ? (
            <img src={auth.user.avatar} alt="" className="h-10 w-10 rounded-[4px] border border-[var(--line)] object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-[4px] bg-white/32 text-[18px] font-medium text-[var(--text-1)]">
              {auth.user.uname.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] text-[var(--text-1)]">{auth.user.uname}</div>
            <div className="mt-0.5 font-mono text-[12px] text-[var(--text-2)]">UID {auth.user.mid}</div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="t press rounded-[4px] bg-white h-8 px-4 text-[14px] font-medium text-black hover:bg-white/85"
          >
            完成
          </button>
        </div>
      ) : phase === 'error' && error ? (
        <EmptyState
          icon="alert"
          title="登录链接没有取到"
          detail={error.message}
          action={{ label: '重试', onClick: () => void start() }}
          compact
        />
      ) : !challenge ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-[168px] w-full" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ) : (
        <>
          <QrPanel state={panelState} url={challenge.url} svg={challenge.svg} />

          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => void start()}
              className="t press flex items-center justify-center flex items-center gap-1 rounded-[4px] border border-[var(--line)] h-8 px-4 text-[14px] text-[var(--text-2)] hover:border-[var(--line)] hover:text-[var(--text-1)]"
            >
              <Icon name="refresh" size={12} />
              重新生成
            </button>
            <span className="font-mono text-[12px] text-[var(--text-2)]">有效期 {formatTime(remaining)}</span>
          </div>

          <ol className="mt-4 space-y-1.5 text-[14px] leading-relaxed text-[var(--text-2)]">
            <li>1. 打开手机 B 站，进入「扫一扫」。</li>
            <li>2. 扫码，或打开复制的链接，在手机上确认登录。</li>
            <li>3. 确认后这个弹窗会自动关闭。</li>
          </ol>

          {isTauri ? null : (
            <div className="mt-4 flex items-start gap-2 border-t border-hairline pt-4 text-[12px] leading-relaxed text-[var(--accent)]">
              <Icon name="info" size={13} className="mt-[1px] shrink-0" />
              浏览器预览没有真实二维码：约 5 秒后自动确认登录，用来把状态机走完。
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
