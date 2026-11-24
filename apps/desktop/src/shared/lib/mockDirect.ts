import type { DirectMessage, DirectPeer } from './ipc'
import { avatarArt, CATALOG } from './mockCatalog'
import { fail, state } from './mockEngine'

type Thread = { peer: DirectPeer; messages: DirectMessage[]; unread: number }
const threads = new Map<number, Thread>()
let owner: number | null = null
let nextId = 1000
let failSend = import.meta.env.DEV && new URLSearchParams(window.location.search).has('failDirectSendOnce')
const recallSample = import.meta.env.DEV && new URLSearchParams(window.location.search).has('directRecall')
let firstAck = true
let deliveredRecall = false

function conversations() {
  const me = state.auth.user?.mid
  if (!me) throw fail('needs_login', '请先登录')
  if (owner !== me) {
    owner = me
    threads.clear()
    for (const [index, mid] of [5000, 5002, 5003].entries()) {
      const peer = { mid, name: ['造梦阿瑄', '不睡觉的鹿', '云上的实验室'][index]!, avatar: avatarArt() }
      const at = Math.floor(Date.now() / 1000) - index * 3600 - 600
      const messages = ['看到你发的片段啦。', '谢谢，下次一起看！', '[图片]', '这期投稿更新了。'].map((text, i) => ({
        id: String(++nextId), sender_mid: i === 1 ? me : mid, text,
        image: i === 2 ? '/assets/illustrations/animation-cels.png' : null, at: at + i * 60,
      }))
      threads.set(mid, { peer, messages, unread: index === 0 ? 2 : 0 })
    }
  }
  return threads
}

export function mockDirectUnread() {
  if (!state.auth.logged_in) return 0
  return [...conversations().values()].reduce((sum, chat) => sum + chat.unread, 0)
}

export function mockDirectSessions(cursor: unknown) {
  const sorted = [...conversations().values()].map(({peer, messages, unread}) => {
    const last = messages[messages.length - 1]!
    return { ...peer, unread, preview: last.text, at: last.at }
  }).sort((a, b) => b.at - a.at)
  const start = Number(cursor ?? 0)
  const items = sorted.slice(start, start + 2)
  return { items, next_cursor: start + items.length < sorted.length ? String(start + items.length) : null }
}

export function mockDirectHistory(mid: number, cursor: unknown) {
  const messages = conversations().get(mid)?.messages ?? []
  const end = cursor ? messages.findIndex((item) => item.id === cursor) : messages.length
  const items = messages.slice(Math.max(0, end - 2), end)
  if (recallSample && !cursor && deliveredRecall && messages.length >= 4) {
    return { items: [], next_cursor: messages[2]!.id, latest_seqno: '9900', latest_at: messages[3]!.at + 1,
      withdrawals: [{ target_id: messages[0]!.id, remove: false }, { target_id: messages[2]!.id, remove: true }] }
  }
  return { items, next_cursor: end > items.length ? items[0]?.id : null, latest_seqno: items.at(-1)?.id ?? null,
    latest_at: items.at(-1)?.at ?? null, withdrawals: [] }
}

export function mockDirectAck(mid: number, seqno: string) {
  const chat = conversations().get(mid)
  if (recallSample && firstAck) {
    firstAck = false
    throw fail('internal', '暂时无法标记已读')
  }
  if (chat && chat.messages.at(-1)?.id === seqno) {
    chat.unread = 0
    if (recallSample) deliveredRecall = true
  }
}

export function mockSendDirect(mid: number, text: string) {
  const all = conversations()
  if (failSend) {
    failSend = false
    throw fail('input', '这条私信未发出，请重试。')
  }
  const source = CATALOG.find((track) => track.up_mid === mid)
  const chat = all.get(mid) ?? {
    peer: { mid, name: source?.artist ?? `UID ${mid}`, avatar: source?.up_avatar ?? '' }, messages: [], unread: 0,
  }
  const message = { id: String(++nextId), sender_mid: state.auth.user!.mid, text, at: Math.floor(Date.now() / 1000), image: null }
  chat.messages.push(message)
  all.set(mid, chat)
  return message
}
