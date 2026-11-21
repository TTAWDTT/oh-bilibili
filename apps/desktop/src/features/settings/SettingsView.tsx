import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '../../app/appStore'
import { useAuthStore } from '../auth/authStore'
import { toastDone, toastFailure, toastWarn } from '../../app/notice'
import { formatCount } from '../../shared/lib/format'
import * as ipc from '../../shared/lib/ipc'
import type { Health } from '../../shared/lib/ipc'
import { isTauri } from '../../shared/lib/runtime'
import { EmptyState } from '../../shared/ui/EmptyState'
import { PageTitle } from '../../shared/ui/PageTitle'
import { Avatar } from '../../shared/ui/Avatar'
import { Icon } from '../../shared/ui/Icon'
import type { IconName } from '../../shared/ui/Icon'
import { LevelBadge } from '../../shared/ui/LevelBadge'
import { Mascot2233 } from '../../shared/ui/Mascot2233'
import { ShortcutTable } from './ShortcutTable'
import { useAutoplay } from '../watch/autoplay'
import { useDanmakuSettings } from '../player/danmakuSettings'

/** 窄屏没有侧栏，这些入口收进「我的」，和 B 站 App 的个人页一样排成一排。 */
const SERVICES: readonly {
  kind: 'history' | 'favs' | 'watchLater' | 'following' | 'downloads'
  label: string
  icon: IconName
}[] = [
  { kind: 'history', label: '历史', icon: 'clock' },
  { kind: 'favs', label: '收藏夹', icon: 'bookmarkStar' },
  { kind: 'watchLater', label: '稍后再看', icon: 'watchLater' },
  { kind: 'following', label: '关注', icon: 'user' },
  { kind: 'downloads', label: '已下载', icon: 'download' },
]

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

/** 开关行：左边一项设置，右边 B 站播放器那种 28×16 拨杆。 */
function SwitchRow({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="t flex w-full items-center justify-between py-2.5 text-left"
    >
      <span className="text-[13.5px] text-[var(--text-1)]">{label}</span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          on ? 'bg-[var(--accent)]' : 'bg-[var(--ga2)]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            on ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

export function SettingsView() {
  const auth = useAuthStore((state) => state.auth)
  const logout = useAuthStore((state) => state.logout)
  const setAuthOpen = useAppStore((state) => state.setAuthOpen)
  const navigate = useAppStore((state) => state.navigate)
  const [health, setHealth] = useState<Health | null>(null)
  const [healthFailed, setHealthFailed] = useState(false)
  const [healthNonce, setHealthNonce] = useState(0)
  const [syncing, setSyncing] = useState(false)
  /** 粉丝与关注数。和 UP 名片同一条接口，读不到就不显示。 */
  const [relation, setRelation] = useState<[number, number] | null>(null)
  const user = auth?.logged_in === true ? auth.user : null
  const autoplay = useAutoplay((state) => state.enabled)
  const setAutoplay = useAutoplay((state) => state.setEnabled)
  const danmakuOn = useDanmakuSettings((state) => state.enabled)
  const setDanmakuEnabled = useDanmakuSettings((state) => state.setEnabled)

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
      const outcome = await ipc.syncNow()
      if (outcome.rejected > 0) {
        toastWarn(
          '部分同步失败',
          `${outcome.rejected} 条被拒绝${outcome.detail ? `：${outcome.detail}` : ''}；已推送 ${outcome.synced} 条。`,
        )
      } else if (outcome.deferred > 0) {
        toastWarn(
          '同步稍后重试',
          `${outcome.deferred} 条暂时失败，下次同步会重试${outcome.detail ? `：${outcome.detail}` : ''}；已推送 ${outcome.synced} 条。`,
        )
      } else {
        toastDone('同步完成', '喜欢与收藏已经推给 B 站。')
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
        <div className="flex max-w-[820px] flex-col gap-3 py-4">
          <PageTitle>设置</PageTitle>
          <div className="hidden md:block">
            <Section title="快捷键">
              <ShortcutTable />
            </Section>
          </div>

          <Section title="播放">
            <div className="divide-y divide-[var(--hairline)]">
              <SwitchRow label="自动连播" on={autoplay} onChange={setAutoplay} />
              <SwitchRow label="弹幕" on={danmakuOn} onChange={setDanmakuEnabled} />
            </div>
          </Section>

          <Section title="账号">
            {user ? (
              <div className="overflow-hidden rounded-[6px] border border-[var(--line)]">
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
                    <Avatar src={user.avatar} alt={user.uname} size={120} bordered={false} />
                  </div>
                  <div className="min-w-0 flex-[1_1_240px] pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="min-w-0 truncate text-[19px] font-semibold text-[var(--text-1)]"
                        title={user.uname}
                      >
                        {user.uname}
                      </span>
                      <LevelBadge level={user.level} />
                    </div>
                    <div className="num mt-1 text-[12px] text-[var(--text-2)]">UID {user.mid}</div>
                    <div className="num mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-[var(--text-2)]">
                      <span><span className="font-medium text-[var(--text-1)]">{Number.isInteger(user.coins) ? user.coins : user.coins.toFixed(1)}</span> 硬币</span>
                      {relation ? <span><span className="font-medium text-[var(--text-1)]">{formatCount(relation[0])}</span> 粉丝</span> : null}
                      {relation ? <span><span className="font-medium text-[var(--text-1)]">{formatCount(relation[1])}</span> 关注</span> : null}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigate({ kind: 'author', name: user.uname, mid: user.mid })}
                        className="t press flex h-8 items-center justify-center gap-2 rounded-[6px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90"
                      >
                        <Icon name="user" size={14} />
                        个人空间
                      </button>
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
                        className="t press flex h-8 shrink-0 items-center justify-center gap-1 rounded-[6px] border border-[var(--line)] px-4 text-[14px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        <Icon name="logout" size={13} />
                        退出
                      </button>
                    </div>
                  </div>
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

          <div className="md:hidden">
            <Section title="我的">
              <div className="grid grid-cols-5 gap-1">
                {SERVICES.map((service) => (
                  <button
                    key={service.kind}
                    type="button"
                    onClick={() => navigate({ kind: service.kind })}
                    className="t press flex flex-col items-center gap-1.5 rounded-[6px] py-2 text-[var(--text-2)] hover:bg-[var(--panel-raised)] hover:text-[var(--accent)]"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                      <Icon name={service.icon} size={17} />
                    </span>
                    {service.label}
                  </button>
                ))}
              </div>
            </Section>
          </div>

          <Section title="关于">
            <p className="num text-[13px] text-[var(--text-2)]">
              oh-bilibili {health?.version ?? '…'} · {health?.platform ?? '…'}
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
