import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import { useAuthStore } from '../auth/authStore'
import { toastDone, toastFailure } from '../../app/notice'
import * as ipc from '../../shared/lib/ipc'
import type { Health } from '../../shared/lib/ipc'
import { isTauri } from '../../shared/lib/runtime'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { ShortcutTable } from './ShortcutTable'

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={['rounded-2xl border border-hairline bg-white/[0.02] p-5', className ?? ''].join(' ')}>
      <h2 className="text-[10px] uppercase tracking-[0.22em] text-white/32">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/32">{label}</span>
      <span className="num font-mono text-[10.5px] text-white/72">{value}</span>
    </span>
  )
}

export function SettingsView() {
  const auth = useAuthStore((state) => state.auth)
  const logout = useAuthStore((state) => state.logout)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const [health, setHealth] = useState<Health | null>(null)
  const [healthFailed, setHealthFailed] = useState(false)
  const [healthNonce, setHealthNonce] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const user = auth?.logged_in === true ? auth.user : null

  useEffect(() => {
    let alive = true
    setHealthFailed(false)
    ipc
      .health()
      .then((next) => {
        if (alive) setHealth(next)
      })
      .catch(() => {
        if (alive) setHealthFailed(true)
      })
    return () => {
      alive = false
    }
  }, [healthNonce])

  const sync = useCallback(async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    try {
      await ipc.syncNow()
      toastDone('同步完成', '喜欢与收藏已经推给 B 站。')
    } catch (cause) {
      toastFailure('同步', cause)
    } finally {
      setSyncing(false)
    }
  }, [syncing])

  return (
    <div className="h-full overflow-y-auto px-8 pb-10 pt-8">
      <PageHeader
        eyebrow="设置"
        title="设置"
        subtitle="账号、同步、快捷键与版本信息。这里没有账号切换，只有一个当前登录的账号。"
        actions={null}
      />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title="快捷键" className="lg:col-span-2">
          <ShortcutTable />
        </Card>
        <Card title="账号">
          {user ? (
            <div className="flex items-center gap-4">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="h-14 w-14 rounded-full border border-white/12 object-cover" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#ff3d81] to-[#7c4dff] text-[18px] font-medium text-white/90">
                  {user.uname.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] text-white/90" title={user.uname}>
                  {user.uname}
                </div>
                <div className="num mt-1 font-mono text-[10.5px] text-white/34">UID {user.mid}</div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="t press flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 px-4 py-1.5 text-[11.5px] text-white/60 hover:border-[#ff6b8a]/40 hover:text-[#ff9bb0]"
              >
                <Icon name="logout" size={13} />
                退出
              </button>
            </div>
          ) : (
            <div>
              <div className="text-[13px] text-white/84">未登录</div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-white/36">
                登录后才能把喜欢与收藏写进 B 站账号。凭据只存本机，不上传。
              </p>
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="t press mt-4 rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/88"
              >
                扫码登录
              </button>
            </div>
          )}
        </Card>

        <Card title="同步">
          <div className="text-[13px] text-white/84">喜欢与收藏</div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/36">
            离线操作先落本机，标成待推送；登录后按限速批量推送，失败可以重试。
          </p>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className="t press mt-4 flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-[12px] text-white/84 hover:border-white/24 hover:bg-white/[0.1] disabled:cursor-default disabled:opacity-40"
          >
            <Icon name="sync" size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '同步中…' : '立即同步'}
          </button>
        </Card>

        <Card title="音质">
          <div className="text-[13px] text-white/84">如实显示，不承诺无损</div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/36">
            B 站音轨档位最高约 192K。播放条与右栏显示实际码率，取不到时显示 ——。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip label="档位" value="64 / 132 / 192K" />
            <Chip label="引擎" value={health?.engine ?? (healthFailed ? '不可用' : '…')} />
          </div>
        </Card>

        <Card title="关于">
          <div className="text-[13px] text-white/84">BiliMusic alpha</div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/36">
            音频不进 webview：Rust 取流、解码、输出到声卡，界面只发命令、收事件。本机直连 B 站，不经过中间服务器。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip label="版本" value={health?.version ?? '…'} />
            <Chip label="平台" value={health?.platform ?? '…'} />
            <Chip label="外壳" value={isTauri ? 'Tauri' : '浏览器 mock'} />
          </div>
          {isTauri ? null : (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#7bf0ff]/18 bg-[#7bf0ff]/[0.05] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#9fe6ff]/70">
              <Icon name="info" size={13} className="mt-[2px] shrink-0" />
              当前跑在浏览器预览：音源是 30 秒假音频，登录会在约 5 秒后自动成功。
            </div>
          )}
        </Card>

      </div>

      {healthFailed ? (
        <div className="mt-4">
          <EmptyState
            icon="alert"
            title="外壳信息读不到"
            detail="IPC 通道可能没起来，界面其余部分仍可独立工作。"
            action={{ label: '重试', onClick: () => setHealthNonce((current) => current + 1) }}
            compact
          />
        </div>
      ) : null}
    </div>
  )
}
