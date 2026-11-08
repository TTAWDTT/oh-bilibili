import { useEffect, useState } from 'react'
import { health, type Health } from '../shared/lib/ipc'

const ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4.2 4.2" />
    </>
  ),
  disc: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  heart: <path d="M12 20s-7.2-4.4-7.2-9.1A4 4 0 0 1 12 8.4a4 4 0 0 1 7.2 2.5C19.2 15.6 12 20 12 20Z" />,
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10.6 4 3.8 4-3.8" />
      <path d="M5 19h14" />
    </>
  ),
  prev: (
    <>
      <path d="M18.5 6v12" />
      <path d="M15.5 12 7 6.4v11.2L15.5 12Z" fill="currentColor" stroke="none" />
    </>
  ),
  play: <path d="M9 6.4v11.2L18.5 12 9 6.4Z" fill="currentColor" stroke="none" />,
  next: (
    <>
      <path d="M5.5 6v12" />
      <path d="M8.5 12 17 6.4v11.2L8.5 12Z" fill="currentColor" stroke="none" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4 7h3.2l3 5" />
      <path d="M4 17h3.2l9-10H20" />
      <path d="m17.4 4.6 2.6 2.4-2.6 2.4" />
      <path d="m17.4 14.6 2.6 2.4-2.6 2.4" />
    </>
  ),
  repeat: (
    <>
      <path d="M6 9V8a3 3 0 0 1 3-3h9" />
      <path d="m15.6 2.6 2.6 2.4-2.6 2.4" />
      <path d="M18 15v1a3 3 0 0 1-3 3H6" />
      <path d="m8.4 21.4-2.6-2.4 2.6-2.4" />
    </>
  ),
  volume: (
    <>
      <path d="M5 10v4h3l4 3.4V6.6L8 10H5Z" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6" />
    </>
  ),
} as const

type IconName = keyof typeof ICONS

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}

type NavItem = { id: string; label: string; icon: IconName }

const NAV_ITEMS: NavItem[] = [
  { id: 'search', label: '搜索', icon: 'search' },
  { id: 'library', label: '曲库', icon: 'disc' },
  { id: 'liked', label: '喜欢', icon: 'heart' },
  { id: 'downloads', label: '下载', icon: 'download' },
]

const MILESTONES: { code: string; title: string; detail: string; done: boolean }[] = [
  { code: 'M1', title: '外壳与 IPC', detail: 'Tauri 窗口、命令通道、深空底', done: true },
  { code: 'M2', title: '搜索与登录', detail: 'wbi 签名、二维码登录、结果清洗', done: false },
  { code: 'M3', title: '播放引擎', detail: 'Rust 解码、声卡输出、切歌', done: false },
  { code: 'M4', title: '曲库与同步', detail: 'SQLite、歌单、收藏与点赞', done: false },
]

export default function App() {
  const [status, setStatus] = useState<Health | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState('search')

  useEffect(() => {
    let alive = true
    health()
      .then((next) => {
        if (alive) setStatus(next)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-ink">
      <Aurora />
      <div className="grain pointer-events-none absolute inset-0 z-[1]" />

      <div
        data-tauri-drag-region
        className="relative z-20 flex h-11 shrink-0 items-center pl-[92px] pr-5"
      >
        <span className="text-[13px] font-medium tracking-[0.16em] text-white/35">BILIMUSIC</span>
        <span className="ml-3 rounded-full border border-hairline px-2 py-[1px] text-[10px] text-white/42">
          alpha
        </span>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1">
        <aside className="glass flex w-60 shrink-0 flex-col border-r border-hairline">
          <nav className="flex flex-col gap-1 px-3 py-2">
            {NAV_ITEMS.map((item) => {
              const selected = active === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className={[
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors',
                    selected ? 'bg-white/16 text-white' : 'text-white/82 hover:bg-white/[0.06] hover:text-white/88',
                  ].join(' ')}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </button>
              )
            })}
          </nav>

          <div className="mt-2 px-5 text-[11px] uppercase tracking-[0.18em] text-white/40">歌单</div>
          <div className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
            {['深夜循环', '翻唱现场', '纯音乐与白噪音'].map((name) => (
              <div
                key={name}
                className="truncate rounded-lg px-3 py-2 text-[13px] text-white/58 hover:bg-white/[0.05] hover:text-white/88"
              >
                {name}
              </div>
            ))}
          </div>

          <div className="border-t border-hairline px-4 py-3">
            <div className="text-[13px] text-white/80">未登录</div>
            <div className="mt-0.5 text-[11px] text-white/42">登录后可同步喜欢与收藏</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-10 pb-8 pt-6">
          <h1 className="font-display text-[56px] font-semibold leading-[1.04] tracking-[-0.03em]">
            <span className="text-gradient">把 B 站的声音</span>
            <br />
            <span className="text-white/92">放进你的唱片库</span>
          </h1>
          <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-white/40">
            音源来自你自己的 B 站账号可访问的视频音轨。本机直连，不经过任何中间服务器。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <Chip label="引擎" value={status ? status.engine : '…'} />
            <Chip label="版本" value={status ? status.version : '…'} />
            <Chip label="平台" value={status ? status.platform : '…'} />
            {failed ? <Chip label="IPC" value="失败" tone="bad" /> : null}
          </div>

          <section className="mt-12">
            <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-white/40">开发进度</div>
            <div className="grid grid-cols-4 gap-3">
              {MILESTONES.map((m) => (
                <div
                  key={m.code}
                  className={[
                    'rounded-2xl border p-4 transition-colors',
                    m.done ? 'border-white/15 bg-white/[0.07]' : 'border-hairline bg-white/[0.02]',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-white/35">{m.code}</span>
                    <span
                      className={[
                        'h-1.5 w-1.5 rounded-full',
                        m.done ? 'bg-[#7bf0ff] shadow-[0_0_10px_#7bf0ff]' : 'bg-white/15',
                      ].join(' ')}
                    />
                  </div>
                  <div className="mt-6 text-[14px] text-white/88">{m.title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-white/42">{m.detail}</div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      <footer className="glass relative z-20 flex h-24 shrink-0 items-center gap-5 border-t border-hairline px-6">
        <div className="h-14 w-14 shrink-0 rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.14] to-white/[0.02]" />
        <div className="min-w-0">
          <div className="truncate text-[13px] text-white/88">还没有在播放</div>
          <div className="mt-0.5 truncate text-[11px] text-white/42">搜索一首歌开始</div>
        </div>

        <div className="mx-auto flex flex-col items-center gap-2">
          <div className="flex items-center gap-4 text-white/82">
            <button type="button" className="transition-colors hover:text-white/90">
              <Icon name="shuffle" />
            </button>
            <button type="button" className="transition-colors hover:text-white/90">
              <Icon name="prev" size={20} />
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-[1.04]"
            >
              <Icon name="play" size={17} />
            </button>
            <button type="button" className="transition-colors hover:text-white/90">
              <Icon name="next" size={20} />
            </button>
            <button type="button" className="transition-colors hover:text-white/90">
              <Icon name="repeat" />
            </button>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-white/40">
            <span>0:00</span>
            <div className="h-[2px] w-72 rounded-full bg-white/16" />
            <span>0:00</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-white/40">
          <Icon name="volume" size={16} />
          <div className="h-[2px] w-16 rounded-full bg-white/16" />
        </div>
      </footer>
    </div>
  )
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-hairline bg-white/[0.03] px-3 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</span>
      <span className={['font-mono text-[11px]', tone === 'bad' ? 'text-[#ff6b8a]' : 'text-white/82'].join(' ')}>
        {value}
      </span>
    </span>
  )
}

function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="aurora-blob aurora-nebula"
        style={{
          left: '-14%',
          top: '-16%',
          width: '62%',
          height: '78%',
          background: 'radial-gradient(circle at 40% 40%, rgba(255,61,129,0.52), transparent 62%)',
        }}
      />
      <div
        className="aurora-blob aurora-ember"
        style={{
          right: '-18%',
          top: '6%',
          width: '58%',
          height: '72%',
          background: 'radial-gradient(circle at 50% 50%, rgba(124,77,255,0.48), transparent 64%)',
        }}
      />
      <div
        className="aurora-blob aurora-nebula"
        style={{
          left: '24%',
          bottom: '-30%',
          width: '64%',
          height: '70%',
          background: 'radial-gradient(circle at 50% 50%, rgba(0,229,255,0.28), transparent 66%)',
          animationDelay: '-9s',
        }}
      />
    </div>
  )
}
