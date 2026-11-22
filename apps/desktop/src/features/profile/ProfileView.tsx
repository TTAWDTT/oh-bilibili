import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import { useAuthStore } from '../auth/authStore'
import { toastDone, toastFailure, toastWarn } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import type { IconName } from '../../shared/ui/Icon'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { Mascot2233 } from '../../shared/ui/Mascot2233'
import { PageTitle } from '../../shared/ui/PageTitle'

const SERVICES: readonly {
  kind: 'history' | 'favs' | 'watchLater' | 'following' | 'liked' | 'downloads'
  label: string
  icon: IconName
}[] = [
  { kind: 'history', label: '历史', icon: 'clock' },
  { kind: 'favs', label: '收藏夹', icon: 'bookmarkStar' },
  { kind: 'watchLater', label: '稍后再看', icon: 'watchLater' },
  { kind: 'following', label: '关注', icon: 'user' },
  { kind: 'liked', label: '赞过的视频', icon: 'heart' },
  { kind: 'downloads', label: '已下载', icon: 'download' },
]

/** 窄窗的「我的」：账号与个人内容集中在同一页，设置只做次级入口。 */
export function ProfileView() {
  const auth = useAuthStore((state) => state.auth)
  const logout = useAuthStore((state) => state.logout)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const navigate = useAppStore((state) => state.navigate)
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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

  const refreshAccount = useCallback(async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      useAuthStore.getState().apply(await ipc.authRefresh())
      toastDone('登录状态已刷新')
    } catch (cause) {
      toastFailure('刷新登录状态', cause)
    } finally {
      setRefreshing(false)
    }
  }, [refreshing])

  const sync = useCallback(async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    try {
      const outcome = await ipc.syncNow()
      const failed = outcome.deferred + outcome.rejected
      if (failed > 0) {
        const parts = [`已推送 ${outcome.synced} 条`]
        if (outcome.deferred > 0) parts.push(`${outcome.deferred} 条暂时失败，下次同步会重试`)
        if (outcome.rejected > 0) parts.push(`${outcome.rejected} 条被拒绝`)
        const reason = outcome.detail ? `：${outcome.detail}` : ''
        toastWarn(outcome.rejected > 0 ? '部分同步失败' : '同步稍后重试', `${parts.join('，')}${reason}`)
      } else if (outcome.synced === 0) {
        toastDone('同步完成', '没有待同步的点赞与收藏。')
      } else {
        toastDone('同步完成', `已推送 ${outcome.synced} 条点赞与收藏。`)
      }
    } catch (cause) {
      toastFailure('同步', cause)
    } finally {
      setSyncing(false)
    }
  }, [syncing])

  return (
    <div className="flex h-full flex-col">
      <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-2 md:px-8">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3 py-4">
          <PageTitle
            action={
              <button
                type="button"
                data-profile-settings
                onClick={() => navigate({ kind: 'settings' })}
                className="t press flex h-8 items-center gap-2 rounded-[4px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Icon name="settings" size={14} />
                设置
              </button>
            }
          >
            我的
          </PageTitle>

          <section
            data-profile-account
            className="overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
          >
            {user ? (
              <>
                <div
                  className="relative h-[88px] overflow-hidden"
                  style={{
                    background: 'linear-gradient(115deg, color-mix(in srgb, var(--accent) 23%, white), color-mix(in srgb, var(--accent) 8%, white) 48%, color-mix(in srgb, var(--accent) 20%, white))',
                  }}
                >
                  <Mascot2233 height={192} className="pointer-events-none absolute -bottom-[68px] right-5 opacity-20" />
                </div>
                <div className="flex flex-wrap items-start gap-x-5 gap-y-3 px-4 pb-5 sm:px-5">
                  <div className="relative -mt-10 shrink-0 rounded-full bg-white p-[5px] shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_25%,white),0_3px_12px_color-mix(in oklab, var(--accent) 18%, transparent)]">
                    <Avatar src={user.avatar} alt={user.uname} size={96} bordered={false} />
                  </div>
                  <div className="min-w-0 flex-[1_1_240px] pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-[19px] font-semibold text-[var(--text-1)]" title={user.uname}>
                        {user.uname}
                      </span>
                      <LevelBadge level={user.level} />
                    </div>
                    <div className="num mt-1 text-[12px] text-[var(--text-2)]">UID {user.mid}</div>
                    <div className="num mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[var(--text-2)]">
                      <span>
                        <span className="font-medium text-[var(--text-1)]">
                          {Number.isInteger(user.coins) ? user.coins : user.coins.toFixed(1)}
                        </span>{' '}
                        硬币
                      </span>
                      {relation ? (
                        <span>
                          <span className="font-medium text-[var(--text-1)]">{formatCount(relation[0])}</span> 粉丝
                        </span>
                      ) : null}
                      {relation ? (
                        <span>
                          <span className="font-medium text-[var(--text-1)]">{formatCount(relation[1])}</span> 关注
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 md:flex md:flex-wrap md:items-center">
                      <button
                        type="button"
                        onClick={() => navigate({ kind: 'author', name: user.uname, mid: user.mid })}
                        className="t press flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-[6px] bg-[var(--accent)] px-1.5 text-[12px] font-medium text-white hover:opacity-90 md:gap-2 md:px-4 md:text-[14px]"
                      >
                        <Icon name="user" size={13} className="shrink-0" />
                        个人空间
                      </button>
                      <button
                        type="button"
                        onClick={() => void sync()}
                        disabled={syncing}
                        className="t press flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-[6px] border border-[var(--line)] px-1.5 text-[12px] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-40 md:gap-2 md:px-4 md:text-[14px]"
                      >
                        <Icon name="sync" size={13} className={`shrink-0 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? '同步中…' : '立即同步'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void logout()}
                        className="t press flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[6px] border border-[var(--line)] px-1.5 text-[12px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] md:px-4 md:text-[14px]"
                      >
                        <Icon name="logout" size={12} className="shrink-0" />
                        退出
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="px-5 py-5">
                <div className="text-[15px] font-medium text-[var(--text-1)]">未登录</div>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-2)]">
                  登录后历史、收藏与关注会回到这里。凭据只存本机，不上传。
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthOpen(true)}
                    className="t press h-8 rounded-[6px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90"
                  >
                    扫码登录
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshAccount()}
                    disabled={refreshing}
                    className="t press flex h-8 items-center gap-1 rounded-[6px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-default disabled:opacity-40"
                  >
                    <Icon name="refresh" size={13} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? '刷新中…' : '刷新状态'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[8px] border border-[var(--line)] bg-[var(--panel)] px-5 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <h2 className="text-[14px] font-medium text-[var(--text-1)]">我的内容</h2>
            <div className="mt-3 grid grid-cols-3 gap-1 md:grid-cols-6">
              {SERVICES.map((service) => (
                <button
                  key={service.kind}
                  type="button"
                  data-profile-service={service.kind}
                  onClick={() => navigate({ kind: service.kind })}
                  className="t press flex flex-col items-center gap-1.5 rounded-[6px] py-2 text-[12px] text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon name={service.icon} size={17} />
                  </span>
                  {service.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
