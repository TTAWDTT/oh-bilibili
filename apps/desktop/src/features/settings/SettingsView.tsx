import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import { useAuthStore } from '../auth/authStore'
import { toastDone, toastFailure } from '../../app/notice'
import * as ipc from '../../shared/lib/ipc'
import type { Health } from '../../shared/lib/ipc'
import { isTauri } from '../../shared/lib/runtime'
import { EmptyState } from '../../shared/ui/EmptyState'
import { FramedAvatar } from '../../shared/ui/FramedAvatar'
import { Icon } from '../../shared/ui/Icon'
import { ShortcutTable } from './ShortcutTable'

/**
 * 设置分组卡片。
 *
 * B 站的设置页是一叠带标题的白色卡片，不是一长条用发丝线切开的文字流。
 * 卡片之间留 12px，卡片自己带 8px 圆角和 B 站那条 0 2px 8px 的阴影。
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-5 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
      <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-1)]">
        <span className="h-3 w-[3px] rounded-full bg-[var(--accent)]" />
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-2 rounded-[4px] border border-[var(--line)] px-2 py-1">
      <span className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-2)]">{label}</span>
      <span className="num font-mono text-[12px] text-[var(--text-2)]">{value}</span>
    </span>
  )
}

export function SettingsView() {
  const auth = useAuthStore((state) => state.auth)
  const loggedIn = auth?.logged_in === true
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
    <div className="flex h-full flex-col">
      

      <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-2 md:px-8">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3 py-4">
          <div className="hidden md:block">
            <Section title="快捷键">
              <ShortcutTable />
            </Section>
          </div>

          <Section title="账号">
            {user ? (
              <div className="flex items-center gap-4">
                <FramedAvatar src={user.avatar} alt={user.uname} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] text-[var(--text-1)]" title={user.uname}>
                    {user.uname}
                  </div>
                  <div className="num mt-1 font-mono text-[12px] text-[var(--text-2)]">UID {user.mid}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="t press flex items-center justify-center flex shrink-0 items-center gap-1 rounded-[4px] border border-[var(--line)] h-8 px-4 text-[14px] text-[var(--text-2)] hover:border-[var(--bili-pink)] hover:text-[var(--bili-pink)]"
                >
                  <Icon name="logout" size={13} />
                  退出
                </button>
              </div>
            ) : (
              <div>
                <div className="text-[14px] text-[var(--text-1)]">未登录</div>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-2)]">
                  登录后才能把喜欢与收藏写进 B 站账号。凭据只存本机，不上传。
                </p>
                <button
                  type="button"
                  onClick={() => setAuthOpen(true)}
                  className="t press mt-4 rounded-[4px] bg-white h-8 px-4 text-[14px] font-medium text-black hover:bg-white/85"
                >
                  扫码登录
                </button>
              </div>
            )}
          </Section>

          <Section title="同步">
            <div className="text-[14px] text-[var(--text-1)]">喜欢与收藏</div>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-2)]">
              离线操作先落本机，标成待推送；登录后按限速批量推送，失败可以重试。
            </p>
            {/* 未登录时同步一定失败，别让按钮看起来可用。 */}
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing || !loggedIn}
              title={loggedIn ? '把本地待推送的喜欢与收藏推到 B 站' : '登录后才能同步'}
              className="t press mt-4 flex items-center gap-2 rounded-[4px] border border-[var(--line)] h-8 px-4 text-[14px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-40 disabled:hover:border-[var(--line)] disabled:hover:text-[var(--text-1)]"
            >
              <Icon name="sync" size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? '同步中…' : loggedIn ? '立即同步' : '登录后才能同步'}
            </button>
          </Section>

          <Section title="音质">
            <div className="text-[14px] text-[var(--text-1)]">如实显示，不承诺无损</div>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-2)]">
              普通账号能拿到 64 / 132 / 192K 三档；大会员账号还会出现杜比全景声与 Hi-Res（30250 / 30251）。播放条与右栏显示实际码率，取不到时显示 ——。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip label="档位" value="64 · 132 · 192K · 杜比 · Hi-Res" />
              <Chip label="引擎" value={health?.engine ?? (healthFailed ? '不可用' : '…')} />
            </div>
          </Section>

          <Section title="关于">
            <div className="text-[14px] text-[var(--text-1)]">BiliMusic alpha</div>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-2)]">
              音频不进 webview：Rust 取流、解码、输出到声卡，界面只发命令、收事件。本机直连 B 站，不经过中间服务器。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip label="版本" value={health?.version ?? '…'} />
              <Chip label="平台" value={health?.platform ?? '…'} />
              <Chip label="外壳" value={isTauri ? 'Tauri' : '浏览器 mock'} />
            </div>
            {isTauri ? null : (
              <div className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-[var(--accent)]">
                <Icon name="info" size={13} className="mt-[2px] shrink-0" />
                当前跑在浏览器预览：音源是 30 秒假音频，登录会在约 5 秒后自动成功。
              </div>
            )}
          </Section>

          {healthFailed ? (
            <div className="py-4">
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
      </div>
    </div>
  )
}
