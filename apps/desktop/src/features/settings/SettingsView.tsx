import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { Health } from '../../shared/lib/ipc'
import { isTauri } from '../../shared/lib/runtime'
import { EmptyState } from '../../shared/ui/EmptyState'
import { PageTitle } from '../../shared/ui/PageTitle'
import { Icon } from '../../shared/ui/Icon'
import { ShortcutTable } from './ShortcutTable'
import { useAutoplay } from '../watch/autoplay'
import { useDanmakuSettings } from '../player/danmakuSettings'

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

/** 偏好设置。账号与个人内容在「我的」，这里只放可修改项和参考信息。 */
export function SettingsView() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthFailed, setHealthFailed] = useState(false)
  const [healthNonce, setHealthNonce] = useState(0)
  const autoplay = useAutoplay((state) => state.enabled)
  const setAutoplay = useAutoplay((state) => state.setEnabled)
  const danmakuOn = useDanmakuSettings((state) => state.enabled)
  const setDanmakuEnabled = useDanmakuSettings((state) => state.setEnabled)

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

  return (
    <div className="flex h-full flex-col">
      <div className="bili-canvas min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-2 md:px-8">
        <div className="flex max-w-[820px] flex-col gap-3 py-4">
          <PageTitle>设置</PageTitle>

          <Section title="播放">
            <div className="divide-y divide-[var(--color-hairline)]">
              <SwitchRow label="自动连播" on={autoplay} onChange={setAutoplay} />
              <SwitchRow label="弹幕" on={danmakuOn} onChange={setDanmakuEnabled} />
            </div>
          </Section>

          <div className="hidden md:block">
            <Section title="快捷键">
              <ShortcutTable />
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
