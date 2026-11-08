import type { LyricDoc, Track } from './contract'
import { hueFor } from './format'

type Seed = { title: string; artist: string }

const SEEDS: readonly Seed[] = [
  { title: '晴天', artist: '周杰伦' },
  { title: '起风了', artist: '买辣椒也用券' },
  { title: '孤勇者', artist: '陈奕迅' },
  { title: '大鱼', artist: '周深' },
  { title: '海底', artist: '一支榴莲' },
  { title: '漠河舞厅', artist: '柳爽' },
  { title: '我记得', artist: '赵雷' },
  { title: '成都', artist: '赵雷' },
  { title: '平凡之路', artist: '朴树' },
  { title: '夜空中最亮的星', artist: '逃跑计划' },
  { title: '光年之外', artist: 'G.E.M. 邓紫棋' },
  { title: '句号', artist: 'G.E.M. 邓紫棋' },
  { title: '山楂树之恋', artist: '要不要买菜' },
  { title: '春庭雪', artist: '等什么君' },
  { title: '关山酒', artist: '等什么君' },
  { title: '白噪音 · 雨落屋檐', artist: '环境音' },
  { title: '钢琴 · 月光练习曲', artist: '纯音乐' },
  { title: '吉他 · 午后四点', artist: '指弹' },
]

function coverArt(title: string, hue: number): string {
  const glyph = title.slice(0, 1)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 68% 22%)"/><stop offset="0.55" stop-color="hsl(${(hue + 38) % 360} 82% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 318) % 360} 62% 14%)"/></linearGradient></defs><rect width="240" height="240" fill="url(#g)"/><circle cx="186" cy="54" r="88" fill="hsl(${(hue + 84) % 360} 92% 72%)" opacity="0.2"/><circle cx="50" cy="198" r="72" fill="#000" opacity="0.18"/><circle cx="120" cy="120" r="58" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1"/><text x="20" y="202" font-size="112" font-family="-apple-system, PingFang SC, sans-serif" font-weight="600" fill="#fff" opacity="0.16">${glyph}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const CATALOG: readonly Track[] = SEEDS.map((seed, index) => {
  const key = `BV1Mk4y1${String(1000 + index * 37)}`
  return {
    key,
    title: seed.title,
    artist: seed.artist,
    // 浏览器 mock 的假音源统一在 30 秒上下，进度、切歌、歌词一屏内就能走完。
    duration_ms: 26_000 + ((index * 1700) % 7000),
    cover: coverArt(seed.title, hueFor(key)),
    // 播放量按名次递减，排行榜才有真实感；不是随机数。
    views: 9_800_000 - index * 420_000,
    danmaku: 42_000 - index * 1_800,
    tname: '音乐',
    typeid: 3,
    up_mid: 900000 + index,
  }
})

export function findTrack(key: string): Track | null {
  return CATALOG.find((track) => track.key === key) ?? null
}

export function trackByTitle(title: string): Track | null {
  return CATALOG.find((track) => track.title === title) ?? null
}

const SCRIPTS: readonly (readonly string[])[] = [
  [
    '夜色把城市折成一封信',
    '我把它放进风里',
    '街灯一盏一盏亮起',
    '像你走时留下的脚印',
    '如果声音能被接住',
    '请替我说一句晚安',
    '海面安静地起伏',
    '月亮在水里练字',
    '我把心事唱得很轻',
    '轻到只剩呼吸',
  ],
  [
    '风从很远的地方来',
    '带着夏天的味道',
    '我站在回声中间',
    '听见旧日的歌',
    '时间把名字磨平',
    '却把旋律留下',
    '再唱一次那一段',
    '让灯一直亮着',
    '我们都会走很远',
    '也会在这里重逢',
  ],
  [
    '雨落在屋檐的边角',
    '一声一声地数着',
    '窗外的世界很慢',
    '慢到能看清一盏灯',
    '我把手放在风里',
    '接住一点温度',
    '所有没说出口的话',
    '都变成了和弦',
    '就这样安静地走',
    '走到天亮为止',
  ],
  [
    '列车穿过长夜',
    '穿过没有名字的站',
    '我在车窗上写字',
    '写完又被雾气抹掉',
    '远处的灯火在退',
    '像旧朋友挥手',
    '下一站还很久',
    '足够再想一遍',
    '把心放回原处',
    '让它自己安静',
  ],
  [
    '海把光揉成碎片',
    '撒在无人的地方',
    '我听见很轻的潮声',
    '像有人叫我回家',
    '如果自由有形状',
    '大概是一阵风',
    '吹过山也吹过你',
    '不问方向',
    '我们再唱一遍',
    '直到天亮',
  ],
]

const PLAIN_LINES = [
  '这是一段还没有时间轴的歌词',
  '只作为纯文本滚动显示',
  'B 站字幕与本地 lrc 都可能落进这个分支',
  '有逐字时间轴时会自动切成扫色模式',
]

/** 每首歌的歌词形态不同，UI 的同步 / 纯文本 / 空态三条分支都能在 mock 里走到。 */
export function buildLyrics(track: Track): LyricDoc {
  const index = CATALOG.findIndex((item) => item.key === track.key)
  if (index < 0) return { lines: [], synced: false, source: 'none' }
  if (index % 7 === 5) {
    return { lines: [], synced: false, source: 'none' }
  }
  if (index % 9 === 7) {
    return {
      lines: PLAIN_LINES.map((text) => ({ at_ms: 0, text })),
      synced: false,
      source: 'B 站字幕',
    }
  }
  const script = SCRIPTS[index % SCRIPTS.length] ?? []
  const count = 7 + (index % 3)
  const duration = track.duration_ms ?? 30_000
  const start = 1200
  const step = Math.max(1800, Math.floor((duration - start - 1400) / count))
  return {
    lines: script.slice(0, count).map((text, line) => ({ at_ms: start + line * step, text })),
    synced: true,
    source: 'lrclib',
  }
}

export type PlaylistSeed = { id: number; name: string; titles: readonly string[] }

/** 用标题而不是裸 key 建种子歌单，避免 key 生成规则与种子数据两处各写一遍。 */
export const PLAYLIST_SEEDS: readonly PlaylistSeed[] = [
  { id: 1, name: '深夜循环', titles: ['晴天', '大鱼', '海底', '夜空中最亮的星', '白噪音 · 雨落屋檐'] },
  { id: 2, name: '翻唱现场', titles: ['起风了', '春庭雪', '关山酒', '山楂树之恋'] },
  { id: 3, name: '纯音乐与白噪音', titles: ['白噪音 · 雨落屋檐', '钢琴 · 月光练习曲', '吉他 · 午后四点'] },
]

export function avatarArt(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3d81"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs><rect width="96" height="96" fill="url(#a)"/><circle cx="48" cy="38" r="16" fill="rgba(255,255,255,0.85)"/><path d="M16 92c4-20 17-28 32-28s28 8 32 28z" fill="rgba(255,255,255,0.85)"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
