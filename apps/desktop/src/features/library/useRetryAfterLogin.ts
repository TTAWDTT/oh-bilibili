import { useEffect, useEffectEvent } from 'react'
import { useAuthStore } from '../auth/authStore'
import type { WireError } from '../../shared/lib/contract'

export function useRetryAfterLogin(error: WireError | null, retry: () => void): void {
  const loggedIn = useAuthStore((state) => state.auth?.logged_in === true)
  const retryIfRequired = useEffectEvent(() => {
    if (error?.class === 'needs_login') retry()
  })

  useEffect(() => {
    if (loggedIn) retryIfRequired()
  }, [loggedIn])
}
