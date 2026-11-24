import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '../../app/appStore'
import * as ipc from '../../shared/lib/ipc'
import { toWireError } from '../../shared/lib/errors'
import { formatRelative } from '../../shared/lib/format'
import { Avatar } from '../../shared/ui/Avatar'
import { BiliLoader } from '../../shared/ui/BiliLoader'
import { Icon } from '../../shared/ui/Icon'
import { useAuthStore } from '../auth/authStore'
import { useDirectPages } from './useDirectPages'
import { DirectCards } from './DirectCards'
import { quoteNodes } from './quoteNodes'
import { DirectComposer } from './DirectComposer'
import './direct.css'

const sessionKey = (item: ipc.DirectSession) => item.mid
const messageKey = (item: ipc.DirectMessage) => item.id
const clockTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export type Composer = { image: File | null; text: string; sending: boolean; error: string | null }
const emptyComposer: Composer = { image: null, text: '', sending: false, error: null }

export function DirectInbox({ me, emotes, selected, onSelect }: {
  me: number
  emotes: Map<string, string>
  selected: ipc.DirectPeer | undefined
  onSelect: (peer?: ipc.DirectPeer) => void
}) {
  const sessions = useDirectPages(ipc.directSessions, sessionKey, true)
  const afterRead = useCallback((mid: number, at: number) => {
    if (useAuthStore.getState().auth?.user?.mid !== me) return
    sessions.updateItem(mid, (item) => item.at <= at ? { ...item, unread: 0 } : item)
    void sessions.load(null)
    void ipc.messageUnread().then((unread) => {
      if (useAuthStore.getState().auth?.user?.mid === me) useAppStore.getState().setMessageUnread(unread)
    }).catch(() => {})
  }, [sessions.load, sessions.updateItem, me])
  const [composers, setComposers] = useState<Record<number, Composer>>({})
  const sending = useRef(new Set<number>())

  function update(mid: number, values: Partial<Composer>) {
    setComposers((old) => ({ ...old, [mid]: { ...(old[mid] ?? emptyComposer), ...values } }))
  }

  async function send(peer: ipc.DirectPeer, received: (message: ipc.DirectMessage) => void) {
    const { text, image } = composers[peer.mid] ?? emptyComposer
    if ((!text.trim() && !image) || sending.current.has(peer.mid)) return
    sending.current.add(peer.mid)
    update(peer.mid, { sending: true, error: null })
    try {
      const message = image ? await ipc.sendDirectImage(peer.mid, image) : await ipc.sendDirectText(peer.mid, text.trim())
      received(message)
      const unread = sessions.items.find((item) => item.mid === peer.mid)?.unread ?? 0
      sessions.addLatest({ ...peer, preview: message.text, at: message.at, unread })
      update(peer.mid, { ...(image ? { image: null } : { text: '' }), sending: false, error: null })
    } catch (cause) {
      const failure = toWireError(cause)
      if (failure.class === 'needs_login') useAppStore.getState().setAuthOpen(true)
      update(peer.mid, { error: failure.message, sending: false })
    } finally {
      sending.current.delete(peer.mid)
    }
  }

  return (
    <div className="dm-shell" data-thread-open={!!selected}>
      <aside className="dm-contacts" aria-label="最近联系">
        <div className="dm-bar">
          <h3>最近联系</h3>
          <button type="button" className="dm-icon" aria-label="刷新联系人" title="刷新联系人" disabled={sessions.busy}
            onClick={() => void sessions.load(null)}><Icon name="refresh" size={16} /></button>
        </div>
        <div className="dm-list">
          {!sessions.loaded && sessions.busy && <BiliLoader compact label="正在取联系人…" />}
          {sessions.items.map((peer) => (
            <button type="button" key={peer.mid} data-direct-peer={peer.mid} aria-label={`与${peer.name}的私信`}
              aria-current={selected?.mid === peer.mid ? 'true' : undefined}
              className="dm-contact" onClick={() => onSelect({ mid: peer.mid, name: peer.name, avatar: peer.avatar })}>
              <Avatar src={peer.avatar} alt={peer.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2"><strong className="truncate">{peer.name}</strong>
                  <time className="ml-auto shrink-0">{formatRelative(peer.at)}</time></span>
                <span className="flex items-center gap-1.5">
                  <span className="dm-preview truncate">{peer.preview}</span>
                  {peer.unread > 0 && <span className="dm-count num" aria-label={`${peer.unread}条未读`}>{peer.unread > 99 ? '99+' : peer.unread}</span>}
                </span>
              </span>
            </button>
          ))}
          {sessions.loaded && !sessions.items.length && !sessions.error && !sessions.next &&
            <p className="dm-empty">还没有私信。可以从 UP 主空间点「发消息」。</p>}
          {sessions.error && <p className="dm-error" role="alert">{sessions.error.message}</p>}
          {(sessions.error || sessions.next) && <button type="button" className="dm-more" disabled={sessions.busy}
            onClick={() => void sessions.load(sessions.error ? sessions.error.cursor : sessions.next)}>
            {sessions.error ? '重试' : '更多联系人'}
          </button>}
        </div>
      </aside>
      {selected ? <DirectThread key={selected.mid} peer={selected} me={me} emotes={emotes} composer={composers[selected.mid] ?? emptyComposer}
        onChange={(values) => update(selected.mid, values)} onSend={(received) => send(selected, received)}
        onBack={() => onSelect()} onRead={afterRead} /> : <div className="dm-placeholder"><Icon name="msgEnvelope" size={44} /><span>选择联系人</span></div>}
    </div>
  )
}

function DirectThread({ peer, me, emotes, composer, onChange, onSend, onBack, onRead }: {
  peer: ipc.DirectPeer
  me: number
  emotes: Map<string, string>
  composer: Composer
  onChange: (values: Partial<Composer>) => void
  onSend: (received: (message: ipc.DirectMessage) => void) => Promise<void>
  onBack: () => void
  onRead: (mid: number, at: number) => void
}) {
  const withdrawals = useRef(new Map<string, boolean>())
  const read = useCallback(async (cursor: string | null) => {
    const page = await ipc.directHistory(peer.mid, cursor)
    for (const { target_id, remove } of page.withdrawals) {
      withdrawals.current.set(target_id, remove || withdrawals.current.get(target_id) === true)
    }
    return page
  }, [peer.mid])
  const applyWithdrawals = useCallback((items: ipc.DirectMessage[]) => items.flatMap((msg) => {
    const remove = withdrawals.current.get(msg.id)
    if (remove === undefined) return [msg]
    if (remove) return []
    return [{ id: msg.id, sender_mid: msg.sender_mid, at: msg.at, text: '消息已撤回', image: null }]
  }), [])
  const history = useDirectPages(read, messageKey, false, applyWithdrawals)
  const navigate = useAppStore((state) => state.navigate)
  const list = useRef<HTMLDivElement>(null)
  const previous = useRef<{ top: number; height: number } | null>(null)
  const [atEnd, setAtEnd] = useState(true)
  const lastAck = useRef<string | null>(null)
  const lastAt = history.latestAt

  useLayoutEffect(() => {
    const box = list.current
    if (!box) return
    if (previous.current) box.scrollTop = previous.current.top + box.scrollHeight - previous.current.height
    else if (atEnd) box.scrollTop = box.scrollHeight
    previous.current = null
  }, [history.items, atEnd])

  useEffect(() => {
    const seq = history.latestSeq
    if (!seq || lastAt === null || !atEnd) return
    const acknowledge = () => {
      if (document.hidden || lastAck.current === seq) return
      lastAck.current = seq
      void ipc.directAck(peer.mid, seq).then(() => onRead(peer.mid, lastAt)).catch(() => {
        if (lastAck.current === seq) lastAck.current = null
      })
    }
    acknowledge()
    document.addEventListener('visibilitychange', acknowledge)
    return () => document.removeEventListener('visibilitychange', acknowledge)
  }, [history.latestSeq, history.items, lastAt, atEnd, peer.mid, onRead])

  function more(cursor: string | null) {
    const box = list.current
    if (cursor && box) previous.current = { top: box.scrollTop, height: box.scrollHeight }
    void history.load(cursor)
  }

  return <section className="dm-thread" aria-label={`与${peer.name}的私信`}>
    <div className="dm-bar">
      <button type="button" aria-label="返回联系人" className="dm-back dm-icon" onClick={onBack}><Icon name="chevronLeft" size={18} /></button>
      <button type="button" className="dm-person" aria-label={`进入 ${peer.name} 的空间`}
        onClick={() => navigate({ kind: 'author', name: peer.name, mid: peer.mid })}>
        <Avatar src={peer.avatar} alt="" size={28} /><span className="truncate">{peer.name}</span>
      </button>
      <button type="button" className="dm-icon ml-auto" aria-label="刷新私信" title="刷新私信" disabled={history.busy}
        onClick={() => void history.load(null)}><Icon name="refresh" size={16} /></button>
    </div>
    <div ref={list} className="dm-messages" role="log" aria-label={`与${peer.name}的消息记录`} aria-live="off"
      onScroll={(e) => { const box = e.currentTarget; setAtEnd(box.scrollHeight - box.clientHeight - box.scrollTop < 24) }}>
      {history.error && <p role="alert" className="dm-error">{history.error.message}</p>}
      {(history.error || history.next) && <button type="button" className="dm-more" disabled={history.busy}
        onClick={() => more(history.error ? history.error.cursor : history.next)}>
        {history.error ? '重试' : '更早的消息'}
      </button>}
      {!history.loaded && history.busy && <BiliLoader compact label="正在取私信…" />}
      {history.loaded && !history.items.length && !history.error && <p className="dm-empty">还没有聊天记录</p>}
      {history.items.map((message) => <div key={message.id} data-direct-message={message.id} data-sender-mid={message.sender_mid}
        className="dm-row" data-mine={message.sender_mid === me}>
        <time dateTime={new Date(message.at * 1000).toISOString()}>{clockTime.format(message.at * 1000)}</time>
        {message.image ? <img src={message.image} alt="图片消息" className="dm-image" referrerPolicy="no-referrer"
          onLoad={() => { if (atEnd && list.current) list.current.scrollTop = list.current.scrollHeight }} />
          : message.text && <p className="dm-bubble">{quoteNodes(message.text, [], message.emotes?.length ? new Map([...emotes, ...message.emotes]) : emotes)}</p>}
        {message.cards?.length ? <DirectCards cards={message.cards} messageId={message.id} /> : null}
      </div>)}
    </div>
    <DirectComposer peer={peer} value={composer} emotes={emotes} onChange={onChange}
      onSend={() => void onSend((message) => { setAtEnd(true); history.addLatest(message) })} />
  </section>
}
