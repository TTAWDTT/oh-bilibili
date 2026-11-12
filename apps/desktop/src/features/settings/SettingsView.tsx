import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import { useAuthStore } from '../auth/authStore'
import { toastDone, toastFailure } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import type { Health } from '../../shared/lib/ipc'
import { isTauri } from '../../shared/lib/runtime'
import { EmptyState } from '../../shared/ui/EmptyState'
import { PageTitle } from '../../shared/ui/PageTitle'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import { LevelBadge } from '../../shared/ui/LevelBadge'
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
      <h2 className="text-[14px] font-medium text-[var(--text-1)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
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
  /** 粉丝与关注数。和 UP 名片同一条接口，读不到就不显示。 */
  const [relation, setRelation] = useState<[number, number] | null>(null)
  const user = auth?.logged_in === true ? auth.user : null

  useEffect(() => {
    if (!user) {
      setRelation(null)
      return
    }
    let alive = true
    void ipc
      .spaceStat(user.mid)
      .then(([fans, following]) => {
        if (alive) setRelation([fans, following])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user?.mid])

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
        <div className="flex max-w-[820px] flex-col gap-3 py-4">
          <PageTitle>设置</PageTitle>
          <div className="hidden md:block">
            <Section title="快捷键">
              <ShortcutTable />
            </Section>
          </div>

          <Section title="账号">
            {user ? (
              <div className="flex flex-wrap items-center gap-4">
                <Avatar src={user.avatar} alt={user.uname} size={96} bordered={false} />
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="truncate text-[17px] font-medium text-[var(--text-1)]"
                      title={user.uname}
                    >
                      {user.uname}
                    </span>
                    <LevelBadge level={user.level} />
                  </div>
                  <div className="num mt-1 font-mono text-[12px] text-[var(--text-2)]">UID {user.mid}</div>
                  <div className="num mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--text-2)]">
                    <span>{Number.isInteger(user.coins) ? user.coins : user.coins.toFixed(1)} 硬币</span>
                    {relation ? <span>{formatCount(relation[0])} 粉丝</span> : null}
                    {relation ? <span>{formatCount(relation[1])} 关注</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void sync()}
                    disabled={syncing}
                    className="t press flex h-8 items-center gap-2 rounded-[6px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-40"
                  >
                    <Icon name="sync" size={14} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? '同步中…' : '立即同步'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="t press flex h-8 shrink-0 items-center justify-center gap-1 rounded-[4px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    <Icon name="logout" size={13} />
                    退出
                  </button>
                </div>
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
                  className="t press mt-4 h-8 rounded-[6px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90"
                >
                  扫码登录
                </button>
              </div>
            )}
          </Section>

          <Section title="关于">
            <p className="num text-[13px] text-[var(--text-2)]">
              BiliMusic {health?.version ?? '…'} · {health?.platform ?? '…'}
            </p>
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
