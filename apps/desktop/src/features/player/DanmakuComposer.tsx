import { useEffect, useState } from 'react'
import { reportActionError } from '../../shared/lib/actionError'
import * as ipc from '../../shared/lib/ipc'
import { toastDone } from '../../app/notice'
import { readPlayhead } from '../../shared/lib/playhead'
import { Icon } from '../../shared/ui/Icon'
import { useSentDanmaku } from './sentDanmaku'

/**
 * B 站播放器底部那条弹幕输入框。
 *
 * 这是 B 站最有辨识度的一处交互：边看边发一句，它会钉在这一刻。
 * 发送走真实接口，落到当前视频的 B 站弹幕池里。
 */
export function DanmakuComposer({
  trackKey,
  onSent,
}: {
  trackKey: string | null
  onSent?: () => void
}) {
  const [text, setText] = useState('')
  // 占位文案里的秒数自己读，不再让整个舞台因为进度变化重渲染
  const [at, setAt] = useState(() => readPlayhead())
  useEffect(() => {
    const timer = window.setInterval(() => setAt(readPlayhead()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const [busy, setBusy] = useState(false)
  const append = useSentDanmaku((s) => s.append)

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!trackKey || value.length === 0 || busy) return
    setBusy(true)
    try {
      await ipc.danmakuSend(trackKey, value, Math.max(0, Math.round(readPlayhead())))
      append(trackKey, { at: Math.max(0, Math.round(readPlayhead())), text: value, color: 'var(--text-1)' })
      setText('')
      toastDone('弹幕已发出', `${Math.floor(at / 1000)} 秒处`)
      onSent?.()
    } catch (e) {
      reportActionError('发弹幕', e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="pointer-events-auto flex w-full max-w-[420px] items-center gap-1.5 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,.08)]"
    >
      <span className="shrink-0 text-[var(--text-3)]">
        <Icon name="queue" size={13} />
      </span>
      <input
        aria-label="发弹幕"
        value={text}
        maxLength={100}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          trackKey ? `在 ${Math.floor(at / 1000)} 秒处发条弹幕` : '选一首再发弹幕'
        }
        disabled={!trackKey || busy}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
      />
      <button
        type="submit"
        disabled={!trackKey || text.trim().length === 0 || busy}
        aria-label="发送"
        title="发送"
        className="t press flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-[var(--accent)] text-white disabled:opacity-40"
      >
        <Icon name="send" size={13} />
      </button>
    </form>
  )
}
