import type { DownloadView, QrStatus } from './contract'
import { CATALOG, avatarArt, buildLyrics, findTrack } from './mockCatalog'
import { bool, num, sleep, str } from './mockArgs'
import { emit, ensureClock, fail, playlistOf, snapshot, state, trackOf } from './mockEngine'
import { playerCommand } from './mockPlayer'

export { mockSubscribe } from './mockEngine'

const COMMENT_SEEDS: { author: string; mid: number; text: string; level: number; medal: string | null }[] = [
  { author: 'UP主本人', mid: 90000, text: '置顶：这条在预览模式里用来验置顶标记。', level: 6, medal: null },
  { author: '耳机党', mid: 90002, text: '前奏一响，DNA 动了。', level: 5, medal: '周杰伦' },
  { author: '夜航船', mid: 90003, text: '第五遍循环，还是这首。', level: 3, medal: null },
]

const FOLLOW_SEEDS: {
  name: string
  sign: string
  official: number | null
  vip: boolean
  mutual: boolean
  special: boolean
}[] = [
  { name: '造梦阿瑄', sign: '每周五更新', official: 0, vip: true, mutual: true, special: true },
  { name: '传送门研究所', sign: '音乐区 UP 主', official: 1, vip: false, mutual: false, special: false },
  { name: '不睡觉的鹿', sign: '翻唱 / 混音', official: null, vip: false, mutual: false, special: false },
]

export async function mockInvoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  ensureClock()
  // 队列相关命令都在 player 侧实现
  if (command.startsWith('queue_') || command.startsWith('player_')) {
    return playerCommand(command, args)
  }

  switch (command) {
    case 'search_q': {
      const query = str(args, 'query').trim()
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      await sleep(140)
      // 时长筛选：mock 的曲目都在 30 秒内，只做「10 分钟以下」这一档的语义
      // duration 是可选参数，未选时传 null，不能走会抛错的 num()
      const dur = typeof args.duration === 'number' ? args.duration : 0
      const matched = CATALOG.filter((track) => {
        const ms = track.duration_ms ?? 0
        if (dur === 1 && ms >= 600_000) return false
        if (dur === 2 && (ms < 600_000 || ms > 1_800_000)) return false
        if (dur === 3 && (ms < 1_800_000 || ms > 3_600_000)) return false
        if (dur === 4 && ms <= 3_600_000) return false
        if (query.length === 0) return true
        return track.title.includes(query) || track.artist.toLowerCase().includes(query.toLowerCase())
      }).sort((left, right) => {
        const leftStarts = left.title.startsWith(query) ? 0 : 1
        const rightStarts = right.title.startsWith(query) ? 0 : 1
        return leftStarts - rightStarts
      })
      return matched.slice((page - 1) * 8, page * 8)
    }
    case 'search_users': {
      const keyword = str(args, 'keyword').trim()
      const seen = new Map<number, string>()
      for (const t of CATALOG) {
        if (!t.up_mid || !t.artist) continue
        if (keyword && !t.artist.includes(keyword) && !keyword.includes(t.artist)) continue
        seen.set(t.up_mid, t.artist)
      }
      return [...seen].slice(0, 4).map(([mid, name], i) => ({
        mid,
        name,
        face: null,
        fans: 12000 * (i + 1),
        videos: 40 + i * 7,
        sign: '预览模式的占位签名',
        level: 6,
        // 前后两条各带一种认证，第三条挂直播，预览里能核对徽章。
        official: i === 0 ? 1 : i === 3 ? 0 : null,
        verify: i === 0 ? '机构认证' : i === 3 ? '个人认证' : '',
        live: i === 2,
      }))
    }
    case 'author_card': {
      const mid = num(args, 'mid')
      const owner = CATALOG.find((t) => t.up_mid === mid)
      if (!owner) throw fail('input', '这个 UP 主不在目录里')
      return {
        name: owner.artist,
        face: owner.up_avatar ?? '',
        // 按 mid 造一个稳定的粉丝数，同一个 UP 每次一样
        fans: 1_200_000 + ((mid ?? 0) % 800_000) * 7,
        sign: '这里是 B 站的占位签名，真机走真实接口。',
        official_type: 1,
        official: null,
        level: 6,
        videos: 952,
        likes: 131_000_000,
      }
    }
    case 'related': {
      // 预览模式给同目录里的相邻几首，够看清右栏推荐的样子。
      const key = str(args, 'key')
      const idx = CATALOG.findIndex((t) => t.key === key)
      const start = idx >= 0 ? idx : 0
      return Array.from({ length: 6 }, (_, i) => CATALOG[(start + i + 1) % CATALOG.length])
    }
    case 'fav_folders':
      // 预览用一个两页的收藏夹，方便验证「加载更多」。
      return [{ id: 1, title: '默认收藏夹', count: 70, cover: CATALOG[0]?.cover ?? null }]
    case 'fav_covers': {
      const limit = Math.max(1, Math.trunc(num(args, 'limit')) || 4)
      return CATALOG.slice(0, limit)
        .map((t) => t.cover)
        .filter((c): c is string => Boolean(c))
    }
    case 'liked_videos':
      return CATALOG.slice(0, 12)
    case 'video_tags':
      return ['翻唱', '虚拟UP主', '音乐']
    case 'comment_emotes':
      return [
        ['[doge]', 'https://i0.hdslb.com/bfs/emote/3087d273a78ccaff4bb1e9972e2ba2a7583c9f11.png'],
        ['[笑哭]', 'https://i0.hdslb.com/bfs/emote/c3043ba94bf4e6bc4d8e8a2d16c1a2c34e36b8bd.png'],
      ]
    case 'ranking':
      return CATALOG.slice(0, 20)
    case 'popular':
      return [CATALOG.slice(0, 20), false]
    case 'precious':
      return {
        title: '入站必刷',
        explain: '预览模式',
        items: CATALOG.slice(0, 12).map((track) => ({ track, note: '预览模式的推荐语' })),
      }
    case 'video_online':
      return 128
    case 'fav_tracks': {
      const page = Math.max(1, Math.trunc(num(args, 'page')) || 1)
      const size = 40
      const start = (page - 1) * size
      return CATALOG.slice(start, start + Math.min(size, CATALOG.length - start))
    }
    case 'history_delete': {
      const key = str(args, 'key')
      state.historyHidden.add(key)
      return null
    }
    case 'history_clear':
      state.historyCleared = true
      return null
    case 'library_history_timed': {
      // 预览模式造三个不同日期的记录，用来验证「今天 / 昨天 / 更早」分组。
      if (state.historyCleared) return []
      const now = Date.now()
      return CATALOG.slice(0, 7)
        .filter((t) => !state.historyHidden.has(t.key))
        .map((track, i) => ({ track, played_at: now - i * 9.5 * 3600_000 }))
    }
    case 'library_history':
      // 预览模式给几条近期记录，让「继续听」区块有内容可看。
      return CATALOG.slice(0, 5)
    case 'set_mode': {
      state.mode = str(args, 'mode') === 'watch' ? 'watch' : 'listen'
      return snapshot()
    }
    case 'close_watch': {
      // 真实应用里离开观看页会停声音；预览也照做，否则退回列表还在响。
      if (state.mode === 'watch') {
        state.mode = 'listen'
        if (state.phase === 'playing') state.phase = 'paused'
      }
      return snapshot()
    }
    case 'home_feed': {
      const fresh = Math.max(0, Math.trunc(num(args, 'fresh')))
      const size = 30
      const start = (fresh * size) % CATALOG.length
      return CATALOG.slice(start, start + size)
    }
    case 'hot_search':
      return ['周杰伦', '晴天', '纯音乐', '夜空中最亮的星', '起风了', '海底']
    case 'watch_open': {
      const track = findTrack(str(args, 'key'))
      if (!track) throw fail('input', '预览模式没有这条视频')
      return {
        key: track.key,
        desc: '预览模式的简介：这里放 UP 主写的正文，链接会做成可点的。',
        owner: track.artist,
        owner_mid: track.up_mid ?? null,
        owner_avatar: track.up_avatar ?? null,
        stats: {
          views: track.views ?? 0,
          danmaku: 233,
          likes: 1200,
          coins: 88,
          favorites: 166,
          shares: 7,
          replies: 12,
        },
        pubdate: Math.floor(Date.now() / 1000) - 86400,
        tname: track.tname ?? null,
        pages: [{ no: 1, cid: 1, title: track.title, duration_ms: track.duration_ms ?? 30_000 }],
        current_page: 1,
        season: null,
        // 预览模式不真的取流，播放器会落到错误层；这里给一个不存在的本机地址。
        manifest_url: 'http://127.0.0.1:1/m/preview.mpd',
        duration_ms: track.duration_ms ?? 30_000,
        qualities: [{ id: 80, label: '1080P', height: 1080, bandwidth: 2_400_000 }],
        audio_quality: 192,
      }
    }
    case 'watch_comments': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      // 预览只造一页评论：第二页再回同一批，界面上就会原样重复一遍。
      if (page > 1) return { total: COMMENT_SEEDS.length, page, items: [], has_more: false }
      return {
        total: COMMENT_SEEDS.length,
        page,
        has_more: false,
        items: COMMENT_SEEDS.map((seed, i) => ({
          id: `${page}-${i}`,
          mid: seed.mid,
          author: seed.author,
          avatar: null,
          text: seed.text,
          emotes: [],
          level: seed.level,
          likes: 30 - i * 3,
          at: Math.floor(Date.now() / 1000) - i * 600,
          replies: [],
          reply_count: 0,
          pinned: i === 0,
          medal: seed.medal
            ? {
                name: seed.medal,
                level: 12,
                color: 0xff87a1bc,
                color_end: 0xff3d3d3d,
                color_border: 0xff87a1bc,
                color_name: 0xffffffff,
                color_level: 0xffffffff,
                level_bg: 0xff3d3d3d,
              }
            : null,
        })),
      }
    }
    case 'watch_replies': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      return {
        total: 2,
        page,
        has_more: false,
        items:
          page === 1
            ? [
                {
                  id: 'r1',
                  mid: 90001,
                  author: '楼里的路人',
                  avatar: null,
                  text: '这条是楼中楼预览数据。',
                  emotes: [],
                  level: 4,
                  likes: 2,
                  at: Math.floor(Date.now() / 1000) - 300,
                  replies: [],
                  reply_count: 0,
                  pinned: false,
                  medal: null,
                },
              ]
            : [],
      }
    }
    case 'following': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      const users = FOLLOW_SEEDS.map((seed, i) => ({
        mid: 5000 + i,
        name: seed.name,
        face: null,
        sign: seed.sign,
        official: seed.official,
        vip: seed.vip,
        mutual: seed.mutual,
        special: seed.special,
      }))
      return [page === 1 ? users : [], users.length]
    }
    case 'space_videos': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      const size = 50
      const start = (page - 1) * size
      return [CATALOG.slice(start, start + size), CATALOG.length]
    }
    case 'space_stat':
      return [36, 1_240_000]
    case 'watch_later_list':
      return CATALOG.slice(0, 9)
    case 'danmaku_send':
      return null
    case 'danmaku_colored': {
      // 造 12 条带时间点的弹幕（第 1~24 秒），用来验证「按时间轴出现」。
      const texts = [
        '爷青回', '这段真的顶', '耳机党狂喜', '循环第 8 遍了', '这就是 B 站',
        '前奏一响 青春就回来了', '谁 2026 年还在听', '音量调大', '泪目',
        '这个转场绝了', '单曲循环中', '干杯',
      ]
      return texts.map((text, i) => [1 + i * 2, text, i % 4 === 0 ? 0xff6699 : 0xffffff])
    }
    case 'danmaku':
      return ['前面的别走！', '这段真的顶', '爷青回', '耳机党狂喜', '循环第 8 遍了', '这就是 B 站']
    case 'library_playlists':
      return state.playlists.map((item) => ({ id: item.id, name: item.name }))
    case 'library_create': {
      const name = str(args, 'name').trim()
      if (name.length === 0) throw fail('input', '歌单名不能为空')
      if (state.playlists.some((item) => item.name === name)) throw fail('input', '已经有同名歌单了')
      const nextId = Math.max(0, ...state.playlists.map((item) => item.id)) + 1
      const playlist = { id: nextId, name, keys: [] as string[] }
      state.playlists.push(playlist)
      emit({ type: 'library_changed' })
      return { id: playlist.id, name: playlist.name }
    }
    case 'library_add': {
      const playlist = playlistOf(Math.trunc(num(args, 'playlist_id')))
      const key = str(args, 'key')
      trackOf(key)
      if (playlist.keys.includes(key)) throw fail('input', `《${playlist.name}》里已经有这首歌了`)
      playlist.keys.push(key)
      emit({ type: 'library_changed' })
      return null
    }
    case 'library_tracks': {
      const playlist = playlistOf(Math.trunc(num(args, 'playlist_id')))
      await sleep(90)
      return playlist.keys.flatMap((key) => {
        const track = findTrack(key)
        return track ? [track] : []
      })
    }
    case 'coin_set':
      return null
    case 'relation_states': {
      // 预览：目录第一条固定是已赞/已藏，用来验证进页面时状态会被点亮。
      // 按「这一批的第一条」算会把鼠标底下那张卡随机点亮，验出来的状态是假的。
      const keys = Array.isArray(args.keys) ? (args.keys as string[]) : []
      const first = CATALOG[0]?.key
      return keys.map((key) => [key, key === first, key === first, key === first ? 1 : 0])
    }
    case 'like_set': {
      const key = str(args, 'key')
      if (bool(args, 'liked')) state.likes.add(key)
      else state.likes.delete(key)
      return null
    }
    case 'unfav_from':
      return null
    case 'fav_set': {
      const key = str(args, 'key')
      if (bool(args, 'faved')) state.favs.add(key)
      else state.favs.delete(key)
      return null
    }
    case 'lyrics_get':
      return buildLyrics(trackOf(str(args, 'key')))
    case 'auth_status':
      return state.auth
    case 'auth_qrcode': {
      const key = `qr-${Date.now().toString(36)}`
      state.qr = {
        key,
        url: `https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=${key}`,
        startedAt: Date.now(),
        expiresIn: 180_000,
        confirmed: false,
      }
      return { key, url: state.qr.url, expires_in_ms: state.qr.expiresIn }
    }
    case 'auth_poll': {
      const key = str(args, 'key')
      if (!state.qr || state.qr.key !== key) return { state: 'expired', auth: null } satisfies QrStatus
      const elapsed = Date.now() - state.qr.startedAt
      if (elapsed >= state.qr.expiresIn) return { state: 'expired', auth: null } satisfies QrStatus
      if (elapsed >= 5200) {
        state.auth = {
          logged_in: true,
          user: { mid: 4381285, uname: '夜航星', avatar: avatarArt(), level: 6, coins: 308.6 },
        }
        if (!state.qr.confirmed) {
          state.qr.confirmed = true
          emit({ type: 'auth_changed', auth: state.auth })
        }
        return { state: 'confirmed', auth: state.auth } satisfies QrStatus
      }
      if (elapsed >= 2400) return { state: 'scanned', auth: null } satisfies QrStatus
      return { state: 'waiting', auth: null } satisfies QrStatus
    }
    case 'auth_logout':
      state.auth = { logged_in: false, user: null }
      state.qr = null
      emit({ type: 'auth_changed', auth: state.auth })
      return state.auth
    case 'download_enqueue': {
      const key = str(args, 'key')
      const track = trackOf(key)
      const existing = state.downloads.find((item) => item.key === key)
      if (existing && (existing.state === 'queued' || existing.state === 'running')) return { ...existing }
      const view: DownloadView = { key, title: track.title, state: 'queued', progress: 0, path: null }
      const index = state.downloads.findIndex((item) => item.key === key)
      if (index >= 0) state.downloads[index] = view
      else state.downloads.push(view)
      emit({ type: 'download', view: { ...view } })
      return { ...view }
    }
    case 'download_remove': {
      const key = str(args, 'key')
      state.downloads = state.downloads.filter((d) => d.key !== key)
      return state.downloads
    }
    case 'download_reveal':
      return null
    case 'downloads_list':
      return state.downloads.map((item) => ({ ...item }))
    case 'sync_now':
      setTimeout(() => emit({ type: 'library_changed' }), 400)
      return null
    default:
      throw fail('internal', `浏览器 mock 还没有实现 ${command}`)
  }
}
