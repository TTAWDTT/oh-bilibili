import { create } from 'zustand'
import type { AuthSnapshot } from '../../shared/lib/contract'
import * as ipc from '../../shared/lib/ipc'
import { toastDone, toastFailure } from '../../app/notice'

type AuthStore = {
  auth: AuthSnapshot | null
  load: () => Promise<void>
  apply: (auth: AuthSnapshot) => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthStore>()((set) => ({
  auth: null,
  load: async () => {
    try {
      set({ auth: await ipc.authStatus() })
    } catch (cause) {
      toastFailure('读取登录状态', cause)
    }
  },
  apply: (auth) => set({ auth }),
  logout: async () => {
    try {
      set({ auth: await ipc.authLogout() })
      toastDone('已退出登录')
    } catch (cause) {
      toastFailure('退出登录', cause)
    }
  },
}))
