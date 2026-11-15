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

/** 预览里发出去的评论，按视频 key 存着，刷新评论列表时插到最前面。 */
const sentComments = new Map<string, { text: string; at: number; id: string }[]>()

export async function mockInvoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  ensureClock()
  // 队列相关命令都在 player 侧实现
  if (command.startsWith('queue_') || command.startsWith('player_')) {
    return playerCommand(command, args)
  }

  switch (command) {
    case 'search_q': {
      const raw = str(args, 'query').trim()
      // 预览用开关：关键词以「限流」开头时，第 2 页起报错，
      // 用来验证翻页失败后的「重试这一页」入口。
      const simulateFailure = raw.startsWith('限流')
      const query = simulateFailure ? raw.slice(2) : raw
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      await sleep(140)
      if (simulateFailure && page > 1) throw fail('internal', '预览：模拟翻页被限流')
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
        vip: true,
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
      // 只放一张确认能取到的图；编出来的 hash 在面板里就是一个碎图标。
      return [['[doge]', 'https://i0.hdslb.com/bfs/emote/3087d273a78ccaff4bb1e9972e2ba2a7583c9f11.png']]
    case 'ranking':
      return CATALOG.slice(0, 20)
    case 'live_rooms':
      return CATALOG.slice(0, 6).map((track, i) => ({
        room_id: 1000 + i,
        title: track.title,
        uname: track.artist,
        face: track.up_avatar ?? null,
        cover: track.cover,
        area: '音乐',
        online: 700_000 - i * 90_000,
        url: `https://live.bilibili.com/${1000 + i}`,
      }))
    case 'bangumi_rank': {
      if (![1, 2, 3, 4, 5].includes(num(args, 'season_type'))) {
        throw fail('input', '分类必须为 1 到 5')
      }
      return CATALOG.slice(0, 6).map((track, i) => ({
        season_id: 33_000 + i,
        title: track.title,
        cover: track.cover,
        rank: i + 1,
        rating: '9.6分',
        index_show: '更新至第12话',
        play_text: '1.2亿',
        url: `https://www.bilibili.com/bangumi/play/ss${33_000 + i}`,
      }))
    }
    case 'followed_bangumi': {
      const page = num(args, 'page')
      const list = page === 1 ? CATALOG.slice(0, 6) : page === 2 ? CATALOG.slice(6, 8) : []
      return [list.map((track, i) => {
        const seasonId = 33_000 + (page === 1 ? i : 6 + i)
        return {
          season_id: seasonId,
          title: track.title,
          cover: track.cover,
          rank: 0,
          rating: '9.6分',
          index_show: '更新至第12话',
          play_text: '',
          url: `https://www.bilibili.com/bangumi/play/ss${seasonId}`,
        }
      }), 8]
    }
    case 'bangumi_timeline':
      return Array.from({ length: 7 }, (_, i) => ({
        date: `11-${String(9 + i).padStart(2, '0')}`,
        weekday: i + 1,
        today: i === 5,
        episodes: CATALOG.slice(i, i + 3).map((track, j) => ({
          season_id: 40_000 + i * 10 + j,
          title: track.title,
          cover: track.cover,
          pub_index: `更新至第${i + 8}话`,
          pub_time: '12:00',
          url: `https://www.bilibili.com/bangumi/play/ss${40_000 + i * 10 + j}`,
        })),
      }))
    case 'popular':
      return {
        items: CATALOG.slice(0, 20).map((track, i) => ({
          track,
          // 和真接口一样：多数条目带标签，少数留空。
          note: i % 3 === 0 ? '' : i % 2 === 0 ? '百万播放' : '7万点赞',
        })),
        no_more: false,
      }
    case 'weekly_issues':
      return Array.from({ length: 8 }, (_, i) => ({
        number: 399 - i,
        subject: `第 ${399 - i} 期的主题`,
        name: `2026第${399 - i}期`,
      }))
    case 'weekly_issue': {
      const number = Math.max(1, Math.trunc(num(args, 'number')))
      await sleep(120)
      return {
        subject: `第 ${number} 期的主题`,
        label: `第${number}期`,
        tracks: CATALOG.slice(0, 12),
        notes: Object.fromEntries(CATALOG.slice(0, 12).map((track) => [track.key, '预览模式的推荐语'])),
      }
    }
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
      // 「听视频」切到听模式时会带上当前曲目与位置：真实引擎从这里接着放，
      // 预览也要接上，否则回到列表就变成「还没有在播放」。
      const key = str(args, 'key')
      const at = num(args, 'at_ms')
      if (key && state.mode === 'listen') {
        const track = findTrack(key)
        if (track) {
          state.keys = [key]
          state.index = 0
          state.duration = track.duration_ms ?? 30_000
          state.position = Number.isFinite(at) ? at : 0
          state.phase = 'playing'
        }
      }
      // 真实引擎切模式后会推一条 state 事件；界面靠它更新底部播放条与右栏。
      const next = snapshot()
      emit({ type: 'state', snapshot: next })
      return next
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
    case 'message_unread':
      return { reply: 3, at: 2, like: 5, total: 10 }
    case 'messages': {
      const kind = str(args, 'kind')
      const page = num(args, 'page')
      const start = typeof args.cursor === 'string' ? Number(args.cursor.split(':')[0] || 0) : 0
      return {
        items: CATALOG.slice(start, start + 8).map((track, index) => ({
          id: `${kind}-${start + index}`,
          kind,
          users: (kind === 'like' ? CATALOG.slice(index, index + 3) : [track]).map((user, i) => ({
            mid: user.up_mid ?? 5000 + i,
            name: user.artist,
            avatar: user.up_avatar ?? '',
          })),
          title: track.title,
          cover: track.cover,
          url: `https://www.bilibili.com/video/${track.key}`,
          bvid: track.key,
          quote: kind === 'like' ? '' : kind === 'at' ? '@你 这首歌一起听！' : '这段副歌太好听了，已经循环好多次。',
          at: Math.floor(Date.now() / 1000) - (start + index + 1) * 1800,
          count: kind === 'like' ? index + 3 : 1,
        })),
        page,
        has_more: start + 8 < 24,
        next_cursor: start + 8 < 24 ? `${start + 8}:0` : null,
      }
    }
    case 'dynamic_feed': {
      const now = Math.floor(Date.now() / 1000)
      return {
        items: [
          {
            id: '{{SECRET_8pepx2sb}}',
            mid: 5000,
            author: '造梦阿瑄',
            face: CATALOG[0]?.up_avatar ?? '',
            official: 0,
            vip: true,
            pub_time: '3小时前',
            pub_ts: now - 10_800,
            text: '新一期翻唱上啦，这次把副歌改成了双声部。',
            bvid: 'BV1xx411c7mD',
            title: '【翻唱】晴天｜一人双声部',
            cover: CATALOG[0]?.cover ?? '',
            duration_ms: CATALOG[0]?.duration_ms ?? null,
            views: 128_000,
            danmaku: 2_340,
          },
          {
            id: '{{SECRET_6mt0ir88}}',
            mid: 5002,
            author: '不睡觉的鹿',
            face: CATALOG[1]?.up_avatar ?? '',
            official: null,
            vip: false,
            pub_time: '昨天 18:20',
            pub_ts: now - 79_200,
            text: '',
            bvid: 'BV1yy411c7mE',
            title: '起风了｜深夜卧室版',
            cover: CATALOG[1]?.cover ?? '',
            duration_ms: CATALOG[1]?.duration_ms ?? null,
            views: 64_500,
            danmaku: 896,
          },
        ],
        offset: '',
        has_more: false,
      }
    }
    case 'search_suggest': {
      const term = str(args, 'term').trim()
      return term ? [term, `${term} 完整版`, `${term} MV`, `${term} 现场`, `${term} 合集`] : []
    }
    case 'hot_search':
      return [
        { keyword: '周杰伦', label: '周杰伦', icon: '', heat: 98_200 },
        { keyword: '晴天', label: '晴天', icon: '', heat: 76_500 },
        { keyword: '纯音乐', label: '纯音乐', icon: '', heat: 61_300 },
        { keyword: '夜空中最亮的星', label: '夜空中最亮的星', icon: '', heat: 45_100 },
        { keyword: '起风了', label: '起风了', icon: '', heat: 33_800 },
        { keyword: '海底', label: '海底', icon: '', heat: 21_600 },
      ]
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
        // 预览给一个三集合集：换成别的视频时把当前这条换进第一集，右栏合集能验到。
        season: {
          id: 1,
          title: '预览合集 · 精选现场',
          episodes: [track, ...CATALOG.filter((t) => t.key !== track.key).slice(0, 2)].map((t) => ({
            key: t.key,
            title: t.title,
            cover: t.cover ?? null,
            duration_ms: t.duration_ms ?? 30_000,
            views: t.views ?? null,
            current: t.key === track.key,
          })),
        },
        // 预览模式不真的取流，播放器会落到错误层；这里给一个不存在的本机地址。
        manifest_url: 'http://127.0.0.1:1/m/preview.mpd',
        duration_ms: track.duration_ms ?? 30_000,
        qualities: [{ id: 80, label: '1080P', height: 1080, bandwidth: 2_400_000 }],
        audio_quality: 192,
      }
    }
    case 'comment_add': {
      const key = str(args, 'key')
      const text = str(args, 'text').trim()
      if (!text) throw fail('input', '评论不能为空')
      const list = sentComments.get(key) ?? []
      const id = `local-${Date.now()}`
      list.unshift({ text, at: Date.now(), id })
      sentComments.set(key, list)
      await sleep(120)
      return id
    }
    case 'watch_comments': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      // 预览只造一页评论：第二页再回同一批，界面上就会原样重复一遍。
      if (page > 1) return { total: COMMENT_SEEDS.length, page, items: [], has_more: false }
      const mine = (sentComments.get(str(args, 'key')) ?? []).map((c) => ({
        id: c.id,
        mid: 1,
        author: '我',
        avatar: null,
        text: c.text,
        emotes: [],
        level: 6,
        likes: 0,
        at: Math.floor(c.at / 1000),
        replies: [],
        reply_count: 0,
        pinned: false,
        medal: null,
      }))
      return {
        total: COMMENT_SEEDS.length + mine.length,
        page,
        has_more: false,
        items: [...mine, ...COMMENT_SEEDS.map((seed, i) => ({
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
        }))],
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
    case 'watch_later_set':
      // 预览里不真的写账号的稍后再看，界面会照常弹「已加入稍后再看」。
      return null
    case 'open_external':
      return null
    case 'comment_del':
      return null
    case 'video_meta': {
      const track = findTrack(str(args, 'key'))
      if (!track) throw fail('input', '预览模式没有这条视频')
      return {
        pubdate: Math.floor(Date.now() / 1000) - 86400,
        tname: track.tname ?? null,
        pages: [],
        season: null,
      }
    }
    case 'danmaku_heat':
      return []
    case 'mv_port':
      return 0
    case 'mv_source':
      return ''
    case 'download_open_dir':
      return null
    case 'follow_set':
      // 预览里不真的改关注关系，返回成功即可；界面上按钮会切成「已关注」。
      return null
    case 'relation_followed':
      return false
    case 'relation_followed_many': {
      const mids = Array.isArray(args.mids) ? (args.mids as number[]) : []
      return mids.map((mid): [number, boolean] => [mid, false])
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
