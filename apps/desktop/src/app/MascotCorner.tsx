import { useState } from 'react'
import { Bili2233 } from '../shared/ui/Bili2233'

/**
 * 右下角常驻的 22/33 娘。
 *
 * 之前 2233 只在 banner 里，滚一下就看不见了。这里让她们站在主区右下角，
 * 一直陪着你——这是国内消费级 App 常见的「虚拟助手」位置，也是 B 站最有
 * 存在感的一处。点一下会有一个气泡说话。
 */
const LINES = [
  '要不要试试搜「晴天」？',
  '弹幕开关在右上角哦',
  '投币是不可撤销的，点之前我会拦你一下',
  '这一页都是你自己播过的',
  '戳我干嘛，听歌去',
]

export function MascotCorner() {
  const [bubble, setBubble] = useState<string | null>(null)

  return (
    <div className="pointer-events-none fixed bottom-[70px] right-[10px] z-10 hidden select-none opacity-70 transition-opacity hover:opacity-100 lg:block">
      {bubble ? (
        <div className="bili-mascot-bubble pointer-events-auto absolute bottom-[calc(100%-8px)] right-2 w-max max-w-[220px] rounded-[8px] border border-[var(--line)] bg-white px-3 py-2 text-[14px] leading-snug text-[var(--text-1)] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.25)]">
          {bubble}
          <span className="absolute -bottom-[5px] right-6 h-2 w-2 rotate-45 border-b border-r border-[var(--line)] bg-white" />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setBubble(LINES[Math.floor(Math.random() * LINES.length)] ?? null)}
        aria-label="和 22 娘 33 娘说句话"
        className="bili-mascot pointer-events-auto block cursor-pointer"
      >
        <Bili2233 width={104} />
      </button>
    </div>
  )
}
