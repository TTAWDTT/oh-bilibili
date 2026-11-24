import type { AppEvent, AuthSnapshot, DownloadView, PageRef, PlayerPhase, PlayerSnapshot, RepeatMode, Track } from './contract'
import { CATALOG, findTrack, PLAYLIST_SEEDS, trackByTitle } from './mockCatalog'
import type { PlaybackResume } from './ipc'
import { clamp } from './format'

export type MockPlaylist = { id: number; name: string; keys: string[] }

export type MockState = {
  watchPage: { key: string; page: PageRef } | null
  keys: string[]
  index: number | null
  localKey: string | null
  /** 最近一次清空前的队列，供撤销恢复。 */
  clearedQueue: { keys: string[]; index: number | null } | null
  phase: PlayerPhase
  /** 观看页打开时是 watch，退回列表就回到 listen。 */
  mode: 'listen' | 'watch'
  position: number
  duration: number
  volume: number
  speed: number
  repeat: RepeatMode
  shuffle: boolean
  likes: Set<string>
  favs: Set<string>
  coins: Map<string, number>
  playlists: MockPlaylist[]
  downloads: DownloadView[]
  /** 被删掉的历史条目 key。 */
  historyHidden: Set<string>
  historyCleared: boolean
  auth: AuthSnapshot
  qr: { key: string; url: string; startedAt: number; expiresIn: number; confirmed: boolean } | null
}

const downloadSeeds: Omit<DownloadView, 'key'>[] = [
  {
    title: '晴天',
    state: 'done',
    progress: 1,
    path: '~/Music/BiliMusic/周杰伦 - 晴天.m4a',
    error: null,
  },
  {
    title: '海底',
    state: 'running',
    progress: 0.38,
    path: null,
    error: null,
  },
  {
    title: '起风了',
    state: 'missing',
    progress: 0,
    path: '~/Music/BiliMusic/起风了.m4a',
    error: null,
  },
]

const loggedIn =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('loggedIn')

const reactedKeys = CATALOG.slice(0, 1).map((track) => track.key)

export const state: MockState = {
  watchPage: null,
  keys: [],
  index: null,
  localKey: null,
  clearedQueue: null,
  phase: 'idle',
  mode: 'listen',
  position: 0,
  duration: 0,
  volume: 0.72,
  speed: 1,
  repeat: 'off',
  shuffle: false,
  likes: new Set(reactedKeys),
  favs: new Set(reactedKeys),
  coins: new Map(reactedKeys.map((key) => [key, 1])),
  playlists: PLAYLIST_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    keys: seed.titles.flatMap((title) => {
      const track = trackByTitle(title)
      return track ? [track.key] : []
    }),
  })),
  downloads: downloadSeeds.flatMap((view) => {
    const track = trackByTitle(view.title)
    return track ? [{ ...view, key: track.key }] : []
  }),
  historyHidden: new Set<string>(),
  historyCleared: false,
  auth: loggedIn
    ? {
        logged_in: true,
        user: {
          mid: 1960976249,
          uname: '-芜芜芜芜芜芜芜湖-',
          avatar: null,
          level: 5,
          coins: 307.6,
        },
      }
    : { logged_in: false, user: null },
  qr: null,
}

const listeners = new Set<(event: AppEvent) => void>()

export function emit(event: AppEvent): void {
  for (const listener of [...listeners]) listener(event)
}

export function mockSubscribe(listener: (event: AppEvent) => void): () => void {
  ensureClock()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function fail(kind: 'input' | 'internal' | 'needs_login', message: string): Error & { class: string } {
  const error = new Error(message) as Error & { class: string }
  error.class = kind
  return error
}

export function trackOf(key: string): Track {
  const track = findTrack(key)
  if (!track) throw fail('input', '找不到这首歌')
  return track
}

export function playlistOf(id: number): MockPlaylist {
  const playlist = state.playlists.find((item) => item.id === id)
  if (!playlist) throw fail('input', '歌单不存在')
  return playlist
}

function currentTrack(): Track | null {
  if (state.localKey) return findTrack(state.localKey)
  return state.index === null ? null : findTrack(state.keys[state.index] ?? '')
}

export function snapshot(): PlayerSnapshot {
  const track = currentTrack()
  return {
    phase: state.phase,
    page: !state.localKey && state.watchPage?.key === track?.key ? state.watchPage?.page ?? null : null,
    track: track && state.localKey ? { ...track, cover: null } : track,
    local: state.localKey !== null,
    mode: state.mode,
    position_ms: Math.round(state.position),
    duration_ms: state.duration,
    volume: state.volume,
    speed: state.speed ?? 1,
    repeat: state.repeat,
    shuffle: state.shuffle,
    quality_kbps: track && !state.localKey ? 192 : null,
  }
}

export function queueView() {
  const items = state.keys.flatMap((key) => {
    const track = findTrack(key)
    return track ? [track] : []
  })
  return { items, index: state.index }
}

export function previewPages(track: Track): PageRef[] {
  const params = new URLSearchParams(window.location.search)
  const many = params.has('manyPages')
  const commentJumps = params.has('commentJumps')
  const history = params.has('watchHistory') && track.key === CATALOG[0]?.key
  const count = history ? 3 : many ? 80 : params.has('multiP') || commentJumps ? 2 : track.pages ?? 1
  return Array.from({ length: count }, (_, index) => ({
    no: index + 1,
    cid: (many ? 100 : 1) + index,
    title: index === 0 ? track.title : index === 61 ? '晴天 · 现场版' : index === 1 ? '第二 P · 预览' : `第 ${index + 1} 集 · 预览`,
    duration_ms: history ? (index === 1 ? 192_000 : 197_000) : many ? 30_000 + index * 1000 : commentJumps ? 300_000 : track.duration_ms ?? 30_000,
  }))
}

export function playIndex(index: number, resume?: PlaybackResume): void {
  const track = findTrack(state.keys[index] ?? '')
  if (!track) {
    endPlayback()
    return
  }
  state.index = index
  state.localKey = null
  const pages = resume ? previewPages(track) : []
  const page = pages.find((part) => part.no === resume?.page) ?? pages[0]
  if (page) state.watchPage = { key: track.key, page }
  state.duration = page?.duration_ms ?? track.duration_ms ?? 30_000
  state.position = resume && page?.no === resume.page ? clamp(resume.position_ms, 0, state.duration) : 0
  state.phase = 'playing'
  emit({ type: 'now_playing', track, index })
  emit({ type: 'progress', position_ms: state.position, duration_ms: state.duration, level: 0 })
}

export function endPlayback(): void {
  state.phase = 'ended'
  state.position = state.duration
  emit({ type: 'progress', position_ms: state.position, duration_ms: state.duration, level: 0.35 })
  emit({ type: 'stopped' })
}

export function step(direction: 1 | -1, announce = false): void {
  const total = state.keys.length
  const current = state.index
  if (total === 0 || current === null) return
  let target = current
  if (state.shuffle && total > 1) {
    do {
      target = Math.floor(Math.random() * total)
    } while (target === current)
  } else {
    target = current + direction
    if (target < 0) {
      if (state.repeat !== 'all') {
        state.position = 0
        emit({ type: 'progress', position_ms: 0, duration_ms: state.duration, level: 0 })
        return
      }
      target = total - 1
    }
    if (target >= total) {
      if (state.repeat !== 'all') {
        if (announce) {
          emit({ type: 'notice', error: { class: 'input', message: '已经是最后一首了' }, op: '下一首' })
          return
        }
        endPlayback()
        return
      }
      target = 0
    }
  }
  playIndex(target)
}

let lastTick = performance.now()
let clock: ReturnType<typeof setInterval> | null = null

function tick(): void {
  const now = performance.now()
  const delta = Math.min(now - lastTick, 2000)
  lastTick = now

  if (state.phase === 'playing') {
    state.position = Math.min(state.position + delta, state.duration)
    emit({ type: 'progress', position_ms: state.position, duration_ms: state.duration, level: 0.35 })
    if (state.position >= state.duration) {
      if (state.repeat === 'one') state.position = 0
      else if (state.localKey) endPlayback()
      else step(1)
    }
  }

  tickDownloads(delta)
}

function tickDownloads(delta: number): void {
  for (const item of state.downloads) {
    if (item.state === 'queued') {
      item.state = 'running'
      emit({ type: 'download', view: { ...item } })
    } else if (item.state === 'running') {
      item.progress = Math.min(1, item.progress + delta / 9000)
      if (item.progress >= 1) {
        item.state = 'done'
        const track = findTrack(item.key)
        item.path = `~/Music/BiliMusic/${track ? `${track.artist} - ${track.title}` : item.title}.m4a`
      }
      emit({ type: 'download', view: { ...item } })
    }
  }
}

export function ensureClock(): void {
  if (clock !== null) return
  lastTick = performance.now()
  clock = setInterval(tick, 250)
}

export function setPosition(position: number): void {
  state.position = clamp(position, 0, state.duration)
  emit({ type: 'progress', position_ms: state.position, duration_ms: state.duration, level: 0.35 })
}

/** 预览里没有真实音频：观看页打开时把这条视频的时长交给播放器状态。 */
export function setDuration(duration: number): void {
  state.duration = Math.max(1, duration)
  emit({ type: 'progress', position_ms: state.position, duration_ms: state.duration, level: 0.35 })
}
