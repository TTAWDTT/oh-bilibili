import { useEffect, useRef, useState } from 'react'
import type { DirectPeer } from '../../shared/lib/ipc'
import { Icon } from '../../shared/ui/Icon'
import type { Composer } from './DirectInbox'

export function DirectComposer({ peer, value, emotes, onChange, onSend }: {
  peer: DirectPeer
  value: Composer
  emotes: Map<string, string>
  onChange: (update: Partial<Composer>) => void
  onSend: () => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [showEmotes, setShowEmotes] = useState(false)
  const [preview, setPreview] = useState('')
  useEffect(() => {
    const url = value.image ? URL.createObjectURL(value.image) : ''
    setPreview(url)
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [value.image])

  function selectImage(file: File) {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      onChange({ error: '请选择 PNG、JPEG、GIF 或 WebP 图片' })
      return
    }
    const limit = file.type === 'image/gif' ? 1 : 20
    if (!file.size || file.size > limit * 1024 * 1024) {
      onChange({ error: `请选择小于等于 ${limit} MB 的非空图片` })
      return
    }
    setShowEmotes(false)
    onChange({ image: file, error: null })
  }

  function insert(code: string) {
    const field = input.current
    if (!field) return
    const start = field.selectionStart
    onChange({ text: value.text.slice(0, start) + code + value.text.slice(field.selectionEnd), error: null })
    setShowEmotes(false)
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + code.length, start + code.length) })
  }

  return <form className="dm-compose" onSubmit={(e) => { e.preventDefault(); onSend() }}>
    {value.image && <div className="dm-attachment">
      {preview && <img src={preview} alt="待发送图片" />}
      <span className="truncate">{value.image.name}</span>
      <button type="button" className="dm-icon" aria-label="移除图片" disabled={value.sending}
        onClick={() => onChange({ image: null, error: null })}><Icon name="close" size={16} /></button>
    </div>}
    <textarea ref={input} aria-label={`给${peer.name}发私信`} placeholder="写私信…" rows={2} readOnly={value.sending}
      value={value.text} onChange={(e) => onChange({ text: e.target.value, error: null })} />
    <div className="dm-compose-actions">
      <button type="button" className="dm-icon" aria-label="选择表情" title="选择表情" aria-expanded={showEmotes}
        disabled={value.sending} onClick={() => setShowEmotes(!showEmotes)}><Icon name="emoji" size={19} /></button>
      {showEmotes && <div className="dm-emotes" aria-label="表情">
        {emotes.size ? [...emotes].map(([code, url]) => <button type="button" key={code} aria-label={code} title={code}
          onClick={() => insert(code)}><img alt="" src={url} loading="lazy" referrerPolicy="no-referrer" /></button>)
          : <p>暂时没有可用表情</p>}
      </div>}
      <button type="button" className="dm-icon" aria-label="选择图片" title="选择图片" disabled={value.sending}
        onClick={() => picker.current?.click()}><Icon name="camera" size={19} /></button>
      <input hidden ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) selectImage(file) }} />
      {value.error && <p role="alert" className="dm-error">{value.error}</p>}
      <button type="submit" className="dm-send" disabled={value.sending || (!value.image && !value.text.trim())}>
        {value.sending ? '发送中…' : value.image ? '发送图片' : '发送'}
      </button>
    </div>
  </form>
}
