import type { QrStatus } from '../../shared/lib/contract'
import { copyText } from '../../shared/lib/clipboard'
import { toastDone, toastFailure } from '../../app/notice'
import { Icon } from '../../shared/ui/Icon'
import type { IconName } from '../../shared/ui/Icon'

const STATUS: Record<QrStatus['state'], { title: string; detail: string; tone: string; icon: IconName }> = {
  waiting: {
    title: '等待扫码',
    detail: '用手机 B 站扫一扫，或把下面的链接复制到手机打开。',
    tone: 'text-white/70',
    icon: 'user',
  },
  scanned: {
    title: '已扫描',
    detail: '请在手机上确认登录，这个弹窗会自动继续。',
    tone: 'text-[var(--accent)]',
    icon: 'check',
  },
  confirmed: {
    title: '登录成功',
    detail: '喜欢与收藏现在会同步到这个账号。',
    tone: 'text-[#7bf0a0]',
    icon: 'check',
  },
  expired: {
    title: '二维码已过期',
    detail: '链接已经失效，点下面的刷新重新生成一个。',
    tone: 'text-[#ffc46b]',
    icon: 'refresh',
  },
}

type QrPanelProps = {
  state: QrStatus['state']
  url: string
  svg: string
}

export function QrPanel({ state, url, svg }: QrPanelProps) {
  const status = STATUS[state]

  const copy = async (): Promise<void> => {
    const copied = await copyText(url)
    if (copied) toastDone('登录链接已复制', '在手机浏览器里打开即可继续登录。')
    else toastFailure('复制链接', { class: 'internal', message: '剪贴板不可用' })
  }

  return (
    <div>
      <div className="flex gap-4">
        <div className="relative flex h-[124px] w-[124px] shrink-0 items-center justify-center overflow-hidden border border-white/32">
          <span
            className="absolute inset-2 rounded-full border border-dashed border-white/32"
            style={{ animation: state === 'waiting' ? 'spin-slow 22s linear infinite' : undefined }}
          />
          <span className="absolute inset-7 rounded-full border border-white/32" />
          <span
            className="absolute inset-0 opacity-50"
            style={{ background: 'radial-gradient(circle at 50% 50%, var(--accent-soft), transparent 70%)' }}
          />
          <span className={`relative ${status.tone}`}>
            <Icon name={status.icon} size={30} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[13px] font-medium ${status.tone}`}>{status.title}</div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/48">{status.detail}</p>
          <button
            type="button"
            onClick={() => void copy()}
            className="t press mt-3 flex h-8 items-center justify-center gap-2 rounded-[4px] border border-white/32 px-3 text-[11px] text-white/70 hover:border-white/32 hover:text-white"
          >
            <Icon name="copy" size={12} />
            复制登录链接
          </button>
        </div>
      </div>
      {svg ? (
        <div className="relative mt-4 flex justify-center">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
            alt="B 站登录二维码"
            width={168}
            height={168}
            className="rounded-[4px] bg-white p-2"
          />
          {state === 'expired' ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-[4px] bg-black/70 text-[12px] text-white">
              二维码已过期，点刷新重来
            </div>
          ) : null}
        </div>
      ) : (
        <div className="selectable mt-4 break-all rounded-[4px] border border-white/32 bg-black/30 px-3 py-2 font-mono text-[10px] leading-relaxed text-white/48">
          {url}
        </div>
      )}
    </div>
  )
}
