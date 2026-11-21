import type { DownloadView, QrStatus } from './contract'
import { CATALOG, avatarArt, buildLyrics, findTrack } from './mockCatalog'
import { REAL_COVERS } from './realCovers'
import { bool, num, sleep, str } from './mockArgs'
import { emit, ensureClock, fail, playlistOf, setDuration, snapshot, state, trackOf } from './mockEngine'
import { playerCommand } from './mockPlayer'

export { mockSubscribe } from './mockEngine'

const COMMENT_SEEDS: { author: string; mid: number; text: string; level: number; medal: string | null }[] = [
  { author: 'UP主本人', mid: 90000, text: '置顶：这条在预览模式里用来验置顶标记。', level: 6, medal: null },
  {
    author: '耳机党',
    mid: 90002,
    text: '00:27 前奏一响，DNA 动了。https://b23.tv/BV1xx411c7mD',
    level: 5,
    medal: '周杰伦',
  },
  {
    author: '夜航船',
    mid: 90003,
    text: '第五遍循环，还是这首。前奏一响，DNA 动了，副歌一进来整个人就被拽回第一次听它的那个下午。那时候还没有现在这么多事情，耳机里循环的只有这一首；现在再听，旋律没变，听歌的人已经被生活推着走了很远。每次到那一句都会想起当时的自己，想起一起听歌的人，想起那些再也回不去的下午。歌还是那首歌，人却已经不是那个人了。但没关系，音乐就是这样，替我们把时间存起来，什么时候按下播放，什么时候就能回去。这些年换过很多耳机，从有线到无线，从入耳到头戴，听歌的场景从书桌换到地铁，从深夜换到通勤。唯一没换的是这首歌的前奏，一响起来，时间就像被人按了倒带。朋友问我为什么总听老歌，我说不是老歌好听，是那些歌里存着我还认得出来的自己。所以第五遍、第十遍、第一百遍都不腻，每一遍都能捡回一点当时的心情。如果有一天我忘了这些，希望这首歌还记得。',
    level: 3,
    medal: null,
  },
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
      // 只放确认能取到的图；编出来的 hash 在面板里就是一个碎图标。
      return [
        ['[doge]', 'https://i0.hdslb.com/bfs/emote/3087d273a78ccaff4bb1e9972e2ba2a7583c9f11.png'],
        ['[2233娘_大笑]', 'https://i0.hdslb.com/bfs/emote/16b8794be990cefa6caeba4d901b934a227ee3b8.png'],
      ]
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
    case 'video_shots':
      return {
        images: ['https://bimp.hdslb.com/videoshotpvhdboss/43538251892_bgvhzb-0001.jpg'],
        index: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45],
        columns: 5,
        rows: 2,
        tile_w: 480,
        tile_h: 270,
      }
    case 'watch_meta':
      return {
        online: 128,
        subtitles: [{ lan: 'zh-CN', label: '中文（中国）' }],
        chapters: [
          { at_ms: 5_000, title: '开场' },
          { at_ms: 15_000, title: '副歌' },
          { at_ms: 25_000, title: '尾声' },
        ],
      }
    case 'watch_summary':
      return {
        summary:
          '预览模式的 AI 总结：这条视频用三段时间讲了同一个主题，先给结论，再补两个例子，最后收回到现场。',
        outline: [
          {
            title: '开场',
            at_ms: 5_000,
            points: [
              { at_ms: 5_000, content: '先把问题摆出来' },
              { at_ms: 15_000, content: '给出第一个例子' },
            ],
          },
          {
            title: '尾声',
            at_ms: 25_000,
            points: [{ at_ms: 25_000, content: '收回到主题' }],
          },
        ],
      }
    case 'watch_subtitles':
      return [
        { at_ms: 0, end_ms: 2400, text: '预览字幕第一句' },
        { at_ms: 2600, end_ms: 5200, text: '预览字幕第二句' },
      ]
    case 'history_position':
      return null
    case 'history_positions': {
      // 预览：把前两条推荐当成看过一半，用来验右栏进度条。
      const keys = Array.isArray(args.keys) ? (args.keys as unknown[]).map(String) : []
      return keys.slice(0, 2).map((key) => [key, 12_000] as [string, number])
    }
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
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('slowHome')) {
        await sleep(10_000)
      }
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
          quote: kind === 'like' ? '' : kind === 'at' ? '@你 这首歌一起听！[2233娘_大笑]' : '这段副歌太好听了，已经循环好多次。',
          at: Math.floor(Date.now() / 1000) - (start + index + 1) * 1800,
          count: kind === 'like' ? index + 3 : 1,
          mentions: kind === 'at' ? [{ mid: 1960976249, name: '你' }] : [],
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
            kind: 'video',
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
            images: [],
            views: 128_000,
            danmaku: 2_340,
            forwards: 3,
            comments: 12,
            likes: 45,
          },
          {
            id: '{{SECRET_6mt0ir88}}',
            mid: 5002,
            kind: 'video',
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
            images: [],
            views: 64_500,
            danmaku: 896,
            forwards: 0,
            comments: 6,
            likes: 18,
          },
          {
            id: '1129036400123456791',
            kind: 'opus',
            mid: 5000,
            author: '造梦阿瑄',
            face: CATALOG[0]?.up_avatar ?? '',
            official: 0,
            vip: true,
            pub_time: '昨天 12:00',
            pub_ts: now - 102_000,
            text: '分享几张最近的拍摄花絮，下一期翻唱正在准备中。',
            bvid: '',
            title: '十一月的拍摄日记',
            cover: CATALOG[0]?.cover ?? '',
            images: CATALOG.slice(0, 3).map((track) => track.cover ?? ''),
            duration_ms: null,
            views: 0,
            danmaku: 0,
            forwards: 2,
            comments: 8,
            likes: 36,
          },
          {
            id: '1129036400123456800',
            kind: 'forward',
            mid: 5003,
            author: '路过的听歌人',
            face: CATALOG[2]?.up_avatar ?? '',
            official: null,
            vip: false,
            pub_time: '2天前',
            pub_ts: now - 172_800,
            text: '这个现场我循环了一整天 #音乐现场#',
            bvid: '',
            title: '',
            cover: '',
            images: [],
            duration_ms: null,
            views: 0,
            danmaku: 0,
            forwards: 1,
            comments: 2,
            likes: 9,
            orig: {
              id: '1129036400123456799',
              kind: 'video',
              mid: 5004,
              author: '被转的 UP',
              face: CATALOG[2]?.up_avatar ?? '',
              official: 0,
              vip: false,
              pub_time: '3天前',
              pub_ts: now - 259_200,
              text: '',
              bvid: 'BV1xx411c7mD',
              title: CATALOG[2]?.title ?? '被转的视频',
              cover: CATALOG[2]?.cover ?? '',
              images: [],
              duration_ms: CATALOG[2]?.duration_ms ?? null,
              views: 88_000,
              danmaku: 1_200,
              forwards: 4,
              comments: 6,
              likes: 21,
            },
          },
          {
            id: '1129036400123456801',
            kind: 'article',
            mid: 5005,
            author: '深夜唱片店',
            face: CATALOG[3]?.up_avatar ?? '',
            official: 1,
            vip: true,
            pub_time: '3天前',
            pub_ts: now - 259_200,
            text: '从氛围到后摇，这十张唱片撑住了整个十一月。',
            bvid: '',
            title: '十一月歌单：适合夜里听的十张专辑',
            cover: CATALOG[3]?.cover ?? '',
            images: [],
            duration_ms: null,
            views: 0,
            danmaku: 0,
            article_id: '246810',
            forwards: 5,
            comments: 3,
            likes: 52,
          },
          {
            id: '1129036400123456802',
            kind: 'live',
            mid: 5006,
            author: '深夜电台',
            face: CATALOG[1]?.up_avatar ?? '',
            official: null,
            vip: false,
            pub_time: '正在直播',
            pub_ts: now,
            text: '',
            bvid: '',
            title: '点歌台｜今晚只放你点的歌',
            cover: CATALOG[1]?.cover ?? '',
            images: [],
            duration_ms: null,
            views: 2_172,
            danmaku: 0,
            room_id: 21204307,
            live_area: '音乐台',
            forwards: 0,
            comments: 0,
            likes: 0,
          },
        ],
        offset: '',
        has_more: false,
      }
    }
    case 'watch_dialog': {
      return {
        total: 0,
        page: 0,
        next: null,
        has_more: false,
        items: [
          {
            id: 'd1',
            root: 1,
            parent: 1,
            dialog: 2,
            mid: 90002,
            author: '对话起点',
            avatar: null,
            text: '这是这条对话的起点。',
            emotes: [],
            mentions: [],
            level: 5,
            likes: 8,
            at: Math.floor(Date.now() / 1000) - 600,
            replies: [],
            reply_count: 0,
            pinned: false,
            up_liked: false,
            liked: false,
            medal: null,
          },
          {
            id: 'd2',
            root: 1,
            parent: 2,
            dialog: 2,
            mid: 90003,
            author: '接话的人',
            avatar: null,
            text: '后面接的一句。',
            emotes: [],
            mentions: [],
            level: 4,
            likes: 3,
            at: Math.floor(Date.now() / 1000) - 540,
            replies: [],
            reply_count: 0,
            pinned: false,
            up_liked: false,
            liked: false,
            medal: null,
          },
        ],
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
      // 预览没有真实音频：把时长交给 mock 播放器，进度条、seek 与热度柱才有得可算。
      setDuration(track.duration_ms ?? 30_000)
      return {
        key: track.key,
        desc: '预览模式的简介：00:12 开场，01:03 副歌，这里放 UP 主写的正文，链接会做成可点的 https://www.bilibili.com/video/BV1xx411c7mD 下面的文字用来验证简介超过两行时的展开与收起，以及窄屏下的排版是否会把按钮挤掉。展开之后应该能看到这一段完整的介绍，收起时恢复到两行，按钮本身不遮挡下面的标签。',
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
      const cursor = args.cursor == null ? null : str(args, 'cursor')
      const ownerMid = findTrack(str(args, 'key'))?.up_mid ?? null
      // 浏览器预览的长列表压测夹具：1000 条长评论，每页 20 条。
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('manyComments')) {
        const page = Number(cursor ?? '1') || 1
        const pageSize = 20
        const total = 1000
        const longText =
          '前奏一响，DNA 动了。副歌一进来，整个人被拽回第一次听它的下午。耳机里循环的只有这一首，旋律没变，听歌的人已经被生活推着走了很远。'.repeat(7)
        const items = Array.from({ length: pageSize }, (_, index) => {
          const n = (page - 1) * pageSize + index
          return {
            id: `many-${n}`,
            mid: 9000 + n,
            author: `预览用户${n}`,
            avatar: null,
            text: `这是第 ${n + 1} 条压测评论。${longText}`,
            emotes: [],
            mentions: [],
            pictures: [],
            level: (n % 6) + 1,
            vip: false,
            likes: n % 97,
            at: Math.floor(Date.now() / 1000) - n * 60,
            replies: [],
            reply_count: 0,
            pinned: false,
            up_liked: false,
            liked: false,
            medal: null,
          }
        })
        return {
          total,
          page,
          next: page * pageSize < total ? String(page + 1) : null,
          items,
          has_more: page * pageSize < total,
        }
      }
      // 预览只造一页评论：带游标再来就回空，界面上不会原样重复一遍。
      if (cursor) return { total: COMMENT_SEEDS.length, page: 1, next: null, items: [], has_more: false }
      const mine = (sentComments.get(str(args, 'key')) ?? []).map((c) => ({
        id: c.id,
        mid: 1,
        author: '我',
        avatar: null,
        text: c.text,
        emotes: [],
        mentions: [],
        level: 6,
        vip: false,
        likes: 0,
        at: Math.floor(c.at / 1000),
        replies: [],
        reply_count: 0,
        pinned: false,
        up_liked: false,
        liked: false,
        medal: null,
      }))
      return {
        total: COMMENT_SEEDS.length + mine.length,
        page: 1,
        next: null,
        has_more: false,
        items: [...mine, ...COMMENT_SEEDS.map((seed, i) => ({
          id: i === 0 ? '1' : `seed-${i}`,
          // 第一条是「UP主本人」，mid 要和当前视频作者一致，只看 UP 主才筛得出来。
          mid: i === 0 && ownerMid !== null ? ownerMid : seed.mid,
          author: seed.author,
          avatar: null,
          text: seed.text,
          emotes: [],
          mentions: [],
          pictures:
            i === 0
              ? ['七里香', '晴天', '起风了', '江南']
                  .map((name) => REAL_COVERS[name])
                  .filter((src): src is string => Boolean(src))
              : [],
          level: seed.level,
          vip: i === 1,
          likes: 30 - i * 3,
          at: Math.floor(Date.now() / 1000) - i * 600,
          replies: i === 0
            ? [
                {
                  id: 'seed-0-r1',
                  root: 1,
                  parent: 1,
                  dialog: 9001,
                  mid: 9001,
                  author: '楼里的路人',
                  avatar: null,
                  text: '这是楼中楼预览的第一条。',
                  emotes: [],
                  mentions: [],
                  level: 4,
                  vip: false,
                  likes: 2,
                  at: Math.floor(Date.now() / 1000) - 500,
                  replies: [],
                  reply_count: 0,
                  pinned: false,
                  up_liked: false,
                  liked: false,
                  medal: null,
                },
                {
                  id: 'seed-0-r2',
                  root: 1,
                  parent: 9001,
                  dialog: 9001,
                  mid: 9002,
                  author: '接话的人',
                  avatar: null,
                  text: '这是回复楼里路人的一条，点查看对话。',
                  emotes: [],
                  mentions: [],
                  level: 5,
                  vip: false,
                  likes: 1,
                  at: Math.floor(Date.now() / 1000) - 400,
                  replies: [],
                  reply_count: 0,
                  pinned: false,
                  up_liked: false,
                  liked: false,
                  medal: null,
                },
              ]
            : [],
          reply_count: i === 0 ? 2 : 0,
          pinned: i === 0,
          up_liked: i === 2,
          liked: false,
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
      const cursor = typeof args.cursor === 'string' ? args.cursor : null
      return {
        total: 2,
        page: 0,
        next: null,
        has_more: false,
        items:
          cursor === null
            ? [
                {
                  id: 'r1',
                  root: 1,
                  parent: 1,
                  dialog: 1,
                  mid: 90001,
                  author: '楼里的路人',
                  avatar: null,
                  text: '这条是楼中楼预览数据。',
                  emotes: [],
                  mentions: [],
                  level: 4,
                  vip: false,
                  likes: 2,
                  at: Math.floor(Date.now() / 1000) - 300,
                  replies: [],
                  reply_count: 0,
                  pinned: false,
                  up_liked: false,
                  liked: false,
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
    case 'save_screenshot':
      return `~/Pictures/oh-bilibili/${str(args, 'name')}.png`
    case 'comment_del': {
      const list = sentComments.get(str(args, 'key'))
      if (list) sentComments.set(str(args, 'key'), list.filter((c) => c.id !== str(args, 'rpid')))
      return null
    }
    case 'comment_like':
      return null
    case 'comment_hate':
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
      // 第 3 条做成顶部弹幕、第 6 条做成底部，用来验证钉住的两种位置。
      return texts.map((text, i) => ({
        secs: 1 + i * 2,
        text,
        color: i % 4 === 0 ? 0xff6699 : 0xffffff,
        mode: i === 2 ? 5 : i === 5 ? 4 : 1,
      }))
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
    case 'auth_refresh':
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
    case 'qr_svg': {
      const text = str(args, 'text')
      const cells: string[] = []
      for (let i = 0; i < 21 * 21; i += 1) {
        if ((i * 7 + text.length) % 5 < 2) cells.push(`M${i % 21} ${Math.floor(i / 21)}h1v1h-1z`)
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="168" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#ffffff"/><path d="${cells.join('')}" fill="#000000"/></svg>`
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
