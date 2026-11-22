import type { DownloadView, QrStatus, Track, WireError } from './contract'
import { CATALOG, avatarArt, buildLyrics, findTrack, registerTrack } from './mockCatalog'
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

type FollowSeed = {
  name: string
  sign: string
  official: number | null
  vip: boolean
  mutual: boolean
  special: boolean
}

/** 第一个账号的 320 个关注：第 286 人签名含「混音」且互关，另有一对同名作者。 */
const FOLLOW_SEEDS: FollowSeed[] = Array.from({ length: 320 }, (_, i) => {
  if (i === 0) {
    return { name: '造梦阿瑄', sign: '每周五更新', official: 0, vip: true, mutual: true, special: true }
  }
  if (i === 1) {
    return { name: '传送门研究所', sign: '音乐区 UP 主', official: 1, vip: false, mutual: false, special: false }
  }
  if (i === 2) {
    return { name: '不睡觉的鹿', sign: '翻唱 / 现场', official: null, vip: false, mutual: false, special: false }
  }
  if (i === 285) {
    return {
      name: '夜间母带师',
      sign: '夜间混音与母带制作',
      official: null,
      vip: true,
      mutual: true,
      special: false,
    }
  }
  if (i === 10 || i === 300) {
    return {
      name: '同名作者',
      sign: i === 10 ? '一号的签名' : '二号的签名',
      official: null,
      vip: false,
      mutual: false,
      special: false,
    }
  }
  if (i === 100) {
    return {
      name: 'LoFi 电台',
      sign: 'Chill beats 与夜晚',
      official: null,
      vip: false,
      mutual: false,
      special: false,
    }
  }
  if (i === 50) {
    return {
      name: '这个名字长到可以把整行撑开的作者',
      sign: '',
      official: null,
      vip: false,
      mutual: false,
      special: false,
    }
  }
  if (i === 51) {
    return {
      name: '没有投稿的作者',
      sign: '',
      official: null,
      vip: false,
      mutual: false,
      special: false,
    }
  }
  return {
    name: `关注作者 ${i + 1}`,
    sign: i % 3 === 0 ? '日常更新' : i % 3 === 1 ? '偶尔直播' : '翻唱与现场',
    official: null,
    vip: false,
    mutual: i % 13 === 0,
    special: i % 29 === 0,
  }
})

/** 扫码登录后的第二个账号：名单和第一个账号完全不同，用来验证换账号后不串数据。 */
const FOLLOW_SEEDS_B: FollowSeed[] = Array.from({ length: 60 }, (_, i) => ({
  name: i === 0 ? '造梦阿瑄' : i === 1 ? '账号二专属' : `账号二作者 ${i + 1}`,
  sign: `第二账号的第 ${i + 1} 位关注`,
  official: null,
  vip: false,
  mutual: false,
  special: false,
}))

const FOLLOW_MID_BASE = 5000
const FOLLOW_B_MID_BASE = 6000

function followByMid(mid: number): { seed: FollowSeed; index: number } | null {
  for (const [base, seeds] of [
    [FOLLOW_MID_BASE, FOLLOW_SEEDS],
    [FOLLOW_B_MID_BASE, FOLLOW_SEEDS_B],
  ] as const) {
    const index = mid - base
    if (index >= 0 && index < seeds.length) return { seed: seeds[index]!, index }
  }
  return null
}

const followTrackCache = new Map<number, Track[]>()

/** 关注名单里的人不一定在首页目录里；给预览造几条确定归属他的投稿。 */
function followTracks(mid: number): Track[] | null {
  const found = followByMid(mid)
  if (!found) return null
  if (mid === FOLLOW_MID_BASE + 51) return []
  const cached = followTrackCache.get(mid)
  if (cached) return cached
  const tracks = Array.from({ length: 4 }, (_, i) => ({
    key: `BVfollow${mid}${i}`,
    title: `${found.seed.name} 的近期投稿 ${i + 1}`,
    artist: found.seed.name,
    duration_ms: 180_000 + i * 1000,
    cover: CATALOG[(found.index + i) % CATALOG.length]?.cover ?? null,
    views: 12_000 + i * 1300,
    danmaku: 80 + i,
    up_avatar: avatarArt(),
    up_mid: mid,
    tname: '音乐',
    typeid: 3,
  }))
  for (const track of tracks) registerTrack(track)
  followTrackCache.set(mid, tracks)
  return tracks
}

/** 预览里发出去的评论，按视频 key 存着，刷新评论列表时插到最前面。 */
const sentComments = new Map<string, { text: string; at: number; id: string }[]>()
let dynamicLoaded = false
/** 历史的假时间戳固定在一次会话里：同一条记录每次查回来 played_at 都一样。 */
const HISTORY_EPOCH = Date.now()

const listError = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('listError') : null
const settledListFailures = new Set<string>()
const followSlow = import.meta.env.DEV && new URLSearchParams(window.location.search).has('followSlow')
const followFailPage = import.meta.env.DEV
  ? Number(new URLSearchParams(window.location.search).get('followFailPage') ?? 0)
  : 0
const spaceSlowMid = import.meta.env.DEV
  ? Number(new URLSearchParams(window.location.search).get('spaceSlowMid') ?? 0)
  : 0
const failedFollowPages = new Set<number>()
const libraryPartial = import.meta.env.DEV && new URLSearchParams(window.location.search).has('libraryPartial')
const libraryBrokenCover =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('libraryBrokenCover')
const libraryEmpty = import.meta.env.DEV && new URLSearchParams(window.location.search).has('libraryEmpty')
/** 预览冒烟专用：让舞台详情晚于首帧到达，复现左栏被撑高、唱片上移。 */
const slowStage = import.meta.env.DEV && new URLSearchParams(window.location.search).has('slowStage')
let libraryPartialRecovered = false
const popularFailOnce =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('popularFailOnce')
let popularFailedOnce = false

export async function mockInvoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  ensureClock()
  // 队列相关命令都在 player 侧实现
  if (command.startsWith('queue_') || command.startsWith('player_')) {
    return playerCommand(command, args)
  }

  if (listError && (command === 'watch_later_list' || command === 'following')) {
    if (listError === 'needs_login' && !state.auth.logged_in) throw fail('needs_login', '需要登录')
    if (!settledListFailures.has(command) && (listError === 'retryable' || listError === 'input')) {
      await sleep(50)
      settledListFailures.add(command)
      const message = listError === 'retryable' ? 'operation timed out' : '列表请求无效'
      throw { class: listError, message } satisfies WireError
    }
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
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      // 预览用开关：模拟接口分页重叠（第 2 页重复第 1 页、第 3 页整页重复），
      // 用来验证按 mid 去重后仍会继续翻页。
      if (keyword.startsWith('重叠')) {
        const make = (mid: number, name: string) => ({
          mid,
          name,
          face: null,
          fans: 12000 * mid,
          videos: 40,
          sign: '预览模式的占位签名',
          level: 6,
          official: null,
          verify: '',
          live: false,
        })
        const pages = [
          [make(101, '重叠UP-A'), make(102, '重叠UP-B')],
          [make(102, '重叠UP-B'), make(103, '重叠UP-C')],
          [make(103, '重叠UP-C')],
          [],
        ]
        await sleep(80)
        return pages[page - 1] ?? []
      }
      const seen = new Map<number, string>()
      for (const t of CATALOG) {
        if (!t.up_mid || !t.artist) continue
        if (keyword && !t.artist.includes(keyword) && !keyword.includes(t.artist)) continue
        seen.set(t.up_mid, t.artist)
      }
      const start = (page - 1) * 4
      return [...seen].slice(start, start + 4).map(([mid, name], offset) => {
        const i = start + offset
        return {
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
        }
      })
    }
    case 'author_card': {
      const mid = num(args, 'mid')
      const owner = CATALOG.find((t) => t.up_mid === mid)
      const follow = followByMid(mid)
      if (!owner && !follow) throw fail('input', '这个 UP 主不在目录里')
      return {
        name: follow?.seed.name ?? owner!.artist,
        face: follow ? avatarArt() : (owner!.up_avatar ?? ''),
        // 按 mid 造一个稳定的粉丝数，同一个 UP 每次一样
        fans: 1_200_000 + ((mid ?? 0) % 800_000) * 7,
        sign: follow?.seed.sign ?? '这里是 B 站的占位签名，真机走真实接口。',
        official_type: 1,
        vip: follow?.seed.vip ?? true,
        official: null,
        level: 6,
        videos: 952,
        likes: 131_000_000,
      }
    }
    case 'related': {
      if (slowStage) await sleep(120)
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
    case 'ranking': {
      // 第一条带上分区：预览里换分区能看出榜单真的换了，而不只是选中态动了。
      // key 保持原样，观看页还要按它找这条视频。
      if (new URL(window.location.href).searchParams.has('slowRanking')) await sleep(1500)
      const rid = num(args, 'rid')
      return CATALOG.slice(0, 20).map((track, index) =>
        index === 0 ? { ...track, title: `${track.title} · 分区 ${rid}` } : track,
      )
    }
    case 'live_rooms': {
      // 每页换一批 room_id，预览翻页时不会把同一间房重复挂到列表中。
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      const count = Math.max(1, Math.trunc(num(args, 'count')))
      const start = (page - 1) * count
      return Array.from({ length: count }, (_, i) => {
        const at = start + i
        const track = CATALOG[at % CATALOG.length]!
        return {
          room_id: 1000 + at,
          title: track.title,
          uname: track.artist,
          face: track.up_avatar ?? null,
          cover: track.cover,
          area: '音乐',
          online: 700_000 - (at % 6) * 90_000,
          url: `https://live.bilibili.com/${1000 + at}`,
        }
      })
    }
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
    case 'popular': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      if (page === 2 && popularFailOnce && !popularFailedOnce) {
        popularFailedOnce = true
        throw Object.assign(new Error('预览：热门第二页失败'), { class: 'retryable' })
      }
      const items = Array.from({ length: 20 }, (_, i) => {
        const at = (page - 1) * 20 + i
        const base = CATALOG[at % CATALOG.length]!
        return {
          // 第二页起换 key，模拟真实分页返回新条目；第一页保持稳定。
          track: page === 1 ? base : { ...base, key: `${base.key}:p${page}:${i}`, title: `${base.title} · 第${page}页` },
          // 和真接口一样：多数条目带标签，少数留空。
          note: i % 3 === 0 ? '' : i % 2 === 0 ? '百万播放' : '7万点赞',
        }
      })
      return { items, no_more: page >= 2 }
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
      // 第一条带期号：预览里能核对期号、下拉和作品属于同一期。
      const tracks = CATALOG.slice(0, 12).map((track, index) =>
        index === 0 ? { ...track, title: `${track.title} · 第 ${number} 期` } : track,
      )
      return {
        subject: `第 ${number} 期的主题`,
        label: `第${number}期`,
        tracks,
        notes: Object.fromEntries(tracks.map((track) => [track.key, '预览模式的推荐语'])),
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
      const now = HISTORY_EPOCH
      const limit = Math.max(1, Math.min(500, Number(args.limit ?? 60) || 60))
      const beforePlayed =
        args.before_played_at == null ? null : Number(args.before_played_at)
      const beforeId = args.before_id == null ? null : Number(args.before_id)
      const seed = CATALOG[0]
      if (!seed) return []
      const long = import.meta.env.DEV && new URLSearchParams(window.location.search).has('historyLong')
      const all = long
        ? [
            ...Array.from({ length: 98 }, (_, i) => ({
              id: i + 1,
              track: { ...seed, key: `history-${i}`, title: `历史记录 ${i + 1} · ${seed.title}` },
              played_at: now - Math.floor(i / 3) * 86_400_000 - (i % 3) * 3_600_000,
              position_ms: i % 5 === 0 ? seed.duration_ms ?? 0 : i % 5 === 4 ? 0 : 12_000,
            })),
            {
              id: 99,
              track: {
                ...seed,
                key: `${seed.key}-cross-2025`,
                title: '跨年同日 · 2025 一段很长的标题用来确认窄窗里也不挤掉播放时间',
                duration_ms: 1_500_000,
              },
              played_at: new Date(2025, 3, 10, 12).getTime(),
              position_ms: 1_122_000,
            },
            {
              id: 100,
              track: { ...seed, key: `${seed.key}-cross-2024`, title: '跨年同日 · 2024', duration_ms: null },
              played_at: new Date(2024, 3, 10, 12).getTime(),
              position_ms: 90_000,
            },
          ]
        : CATALOG.slice(0, 7).map((track, i) => ({
            id: i + 1,
            track,
            played_at: now - i * 9.5 * 3600_000,
            position_ms: [12_000, 0, 20_000, 0, 0, 26_000, 0][i] ?? 0,
          }))
      for (const entry of all) registerTrack(entry.track)
      return all
        .filter((entry) => !state.historyHidden.has(entry.track.key))
        .filter(
          (entry) =>
            beforePlayed === null ||
            entry.played_at < beforePlayed ||
            (entry.played_at === beforePlayed && entry.id < (beforeId ?? 0)),
        )
        .sort((a, b) => b.played_at - a.played_at)
        .slice(0, limit)
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
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('heroAllocation')) {
        const fresh = Math.max(0, Math.trunc(num(args, 'fresh')))
        const original = CATALOG.slice(0, 16).map((track, index) => ({
          ...track,
          key: `allocation-${index}`,
          title: `首页分配 ${index + 1}`,
        }))
        if (fresh === 1) return original
        return [
          ...Array.from({ length: 5 }, (_, index) => ({
            ...original[index],
            key: `swap-${index}`,
            title: `换一换 ${index + 1}`,
          })),
          ...original.slice(11),
          ...Array.from({ length: 5 }, (_, index) => ({
            ...original[index + 5],
            key: `swap-${index + 5}`,
            title: `换一换 ${index + 6}`,
          })),
        ]
      }
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('failHome')) {
        await sleep(120)
        throw Object.assign(new Error('连不上 B 站，检查一下网络。'), { class: 'retryable' })
      }
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
      const params = import.meta.env.DEV ? new URLSearchParams(window.location.search) : undefined
      const longBody = params?.has('longDynamicBody')
      const firstVideo = {
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
      }
      const page = {
        items: [
          firstVideo,
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
            text: longBody ? '录音那天，窗外一直在下雨。\n'.repeat(28) : '',
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
      if (longBody) {
        page.items.push(...Array.from({ length: 4 }, (_, index) => ({
          ...firstVideo,
          id: `long-body-followup-${index}`,
          title: `录音片段 ${index + 1}`,
        })))
      }
      if (params?.has('removeDynamicOnReturn')) {
        if (dynamicLoaded) page.items.splice(1, 1)
        dynamicLoaded = true
      }
      return page
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
      const multiP =
        import.meta.env.DEV && new URLSearchParams(window.location.search).has('multiP')
      const manyPages =
        import.meta.env.DEV && new URLSearchParams(window.location.search).has('manyPages')
      const pages = manyPages
        ? Array.from({ length: 80 }, (_, index) => ({
            no: index + 1,
            cid: 100 + index,
            title:
              index === 0 ? track.title : index === 61 ? '晴天 · 现场版' : `第 ${index + 1} 集 · 预览`,
            duration_ms: 30_000 + index * 1000,
          }))
        : multiP
          ? [
              { no: 1, cid: 1, title: track.title, duration_ms: track.duration_ms ?? 30_000 },
              { no: 2, cid: 2, title: '第二 P · 预览', duration_ms: track.duration_ms ?? 30_000 },
            ]
          : [{ no: 1, cid: 1, title: track.title, duration_ms: track.duration_ms ?? 30_000 }]
      const requestedPage = Number(args.page ?? 1) || 1
      const currentPage = pages.some((entry) => entry.no === requestedPage) ? requestedPage : 1
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
        pages,
        current_page: currentPage,
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
        // 观看页拿到的 duration 是当前这一 P 的时长，不是整条投稿的总长。
        duration_ms: pages.find((entry) => entry.no === currentPage)?.duration_ms ?? track.duration_ms ?? 30_000,
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
          text: i === 1 ? '@阿明 谢谢 @阿明，这段前奏我也循环了很久。' : seed.text,
          emotes: [],
          mentions: i === 1 ? [['阿明', 90002]] : [],
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
      if (slowStage) await sleep(170)
      const track = findTrack(str(args, 'key'))
      if (!track) throw fail('input', '预览模式没有这条视频')
      return {
        desc: '预览模式下的视频简介。',
        pubdate: Math.floor(Date.now() / 1000) - 86400,
        views: track.views ?? 0,
        danmaku: track.danmaku ?? 0,
        replies: 42,
        favorites: 1_024,
        coins: 186,
        shares: 57,
        likes: 2_048,
        tname: track.tname ?? null,
        current_page: 1,
        pages: [
          { no: 1, cid: 900001, title: '正片', duration_ms: track.duration_ms ?? 240_000 },
          { no: 2, cid: 900002, title: '花絮', duration_ms: 180_000 },
        ],
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
      await sleep(250)
      // ?followFail=1 专门用来看失败后重试的就地状态。
      if (new URLSearchParams(window.location.search).get('followFail') === '1') {
        throw fail('internal', '预览：关注请求失败')
      }
      return null
    case 'relation_followed':
      return false
    case 'relation_followed_many': {
      const mids = Array.isArray(args.mids) ? (args.mids as number[]) : []
      return mids.map((mid): [number, boolean] => [mid, false])
    }
    case 'following': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      if (import.meta.env.DEV) performance.mark('following_page', { detail: page })
      // 真接口登录态失效会报 needs_login；listError 场景由上面的开关单独覆盖。
      if (!state.auth.logged_in && !listError) throw fail('needs_login', '需要登录')
      if (followSlow) await sleep(450)
      if (followFailPage === page && !failedFollowPages.has(page)) {
        failedFollowPages.add(page)
        throw { class: 'retryable', message: 'operation timed out' } satisfies WireError
      }
      const second = state.auth.user?.mid === 4381285
      const seeds = second ? FOLLOW_SEEDS_B : FOLLOW_SEEDS
      const base = second ? FOLLOW_B_MID_BASE : FOLLOW_MID_BASE
      const users = seeds.map((seed, i) => ({
        mid: base + i,
        name: seed.name,
        face: null,
        sign: seed.sign,
        official: seed.official,
        vip: seed.vip,
        mutual: seed.mutual,
        special: seed.special,
      }))
      const start = (page - 1) * 50
      return [users.slice(start, start + 50), users.length]
    }
    case 'space_videos': {
      const page = Math.max(1, Math.trunc(num(args, 'page')))
      const size = 50
      const start = (page - 1) * size
      // 空间接口按 mid 返回自己的投稿；排序参数要真的改变顺序，
      // 否则「切排序不换页首」这类测试永远是假通过。
      const mid = num(args, 'mid')
      const order = str(args, 'order')
      if (mid === spaceSlowMid) await sleep(1200)
      let owned = CATALOG.filter((track) => !mid || track.up_mid === mid)
      if (owned.length === 0 && mid) owned = followTracks(mid) ?? []
      // 预览里有一位「多页作者」：用来验证翻页、切排序后页码和总数不丢。
      const longAuthor =
        import.meta.env.DEV && new URLSearchParams(window.location.search).has('authorLong')
      if (longAuthor && mid) {
        const base = owned.length > 0 ? owned : CATALOG.slice(0, 5)
        owned = Array.from({ length: 125 }, (_, index) => {
          const seed = base[index % base.length]!
          return {
            ...seed,
            key: `${seed.key}-long-${index}`,
            title: `${seed.title} 第 ${index + 1} 期`,
            // 播放量随期数递增：切「最多播放」后第一张卡必须真的换人，
            // 否则「切排序不换页首」验的是假数据。
            views: 1_000_000 + index * 1000,
          }
        })
      }
      const sorted = [...owned]
      if (order === 'click') sorted.sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      if (order === 'stow') sorted.sort((a, b) => (b.danmaku ?? 0) - (a.danmaku ?? 0))
      return [sorted.slice(start, start + size), sorted.length]
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
      if (libraryEmpty) return []
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
      const failing = libraryPartial && playlist.id === 2 && !libraryPartialRecovered
      if (libraryPartial) performance.mark('library_tracks', { detail: playlist.id })
      await sleep(90)
      if (failing) {
        libraryPartialRecovered = true
        throw Object.assign(new Error('预览：歌单读取失败'), { class: 'retryable' })
      }
      if (libraryPartial && playlist.id === 3) return []
      return playlist.keys.flatMap((key) => {
        const track = findTrack(key)
        if (!track) return []
        return [
          libraryBrokenCover && playlist.id === 4
            ? { ...track, cover: 'https://example.invalid/broken.jpg' }
            : track,
        ]
      })
    }
    case 'coin_set':
      if (new URL(window.location.href).searchParams.has('failCoin')) {
        throw fail('internal', '投币回执超时')
      }
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
      const part = key.match(/^(BV[a-zA-Z0-9]+)_p([1-9][0-9]*)$/)
      const track = trackOf(part?.[1] ?? key)
      const existing = state.downloads.find((item) => item.key === key)
      if (existing && (existing.state === 'queued' || existing.state === 'running')) return { ...existing }
      const title = part ? `${track.title} · P${part[2]}` : track.title
      const view: DownloadView = { key, title, state: 'queued', progress: 0, path: null, error: null }
      const index = state.downloads.findIndex((item) => item.key === key)
      if (index >= 0) state.downloads[index] = view
      else state.downloads.push(view)
      emit({ type: 'download', view: { ...view } })
      return { ...view }
    }
    case 'download_remove_record': {
      const key = str(args, 'key')
      state.downloads = state.downloads.filter((d) => d.key !== key)
      return state.downloads
    }
    case 'download_delete_audio': {
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
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('syncPartial')) {
        return { synced: 1, deferred: 2, rejected: 0, detail: '请求超时' }
      }
      return { synced: 0, deferred: 0, rejected: 0, detail: null }
    default:
      throw fail('internal', `浏览器 mock 还没有实现 ${command}`)
  }
}
