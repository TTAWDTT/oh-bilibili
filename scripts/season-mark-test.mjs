// 合集书脊标记：用真实模块跑断言，覆盖稿数去重、当前稿兜底与损坏数据。
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, value),
  removeItem: (key) => store.delete(key),
}
const { seasonLabel, rememberSeason, readSeasonMark } =
  await import('../apps/desktop/src/features/tracks/seasonMark.ts')

let failed = 0
function check(name, ok) {
  if (ok) console.log(`ok   ${name}`)
  else {
    failed += 1
    console.error(`FAIL ${name}`)
  }
}

check('没有标记不显示', seasonLabel(null) === null)
check('有稿数写「合集 · N 稿」', seasonLabel({ id: 1, title: '收藏', count: 12 }) === '合集 · 12 稿')
check('稿数为 0 时退回「合集」', seasonLabel({ id: 1, title: '收藏', count: 0 }) === '合集')
check('单稿合集仍按稿数写', seasonLabel({ id: 1, title: '收藏', count: 1 }) === '合集 · 1 稿')

// 目录里没有当前稿时也要写进去，否则这张卡永远没有「所属合集」入口。
rememberSeason(
  {
    id: 7,
    work_count: null,
    title: '文物修复系列',
    episodes: [
      { key: 'BVother', title: '别集', cover: null, duration_ms: 1000, views: null, current: false },
    ],
  },
  'BVcurrent',
)
check('当前稿被补进合集标记', readSeasonMark('BVcurrent')?.id === 7)
check('不完整目录只标合集身份', seasonLabel(readSeasonMark('BVcurrent')) === '合集')
check('目录里的其它集同样被标记', readSeasonMark('BVother')?.id === 7)
check('没有目录时不写', (() => { rememberSeason(null, 'BVx'); return readSeasonMark('BVx') === null })())

// 损坏数据不能崩，也不该画出一个假书脊。
store.set('oh-bilibili:season-of:BVbroken', '{not json')
check('损坏的标记当没有', readSeasonMark('BVbroken') === null)
store.set('oh-bilibili:season-of:BVhalf', JSON.stringify({ id: 1 }))
check('缺稿数的标记当没有', readSeasonMark('BVhalf') === null)

if (failed > 0) process.exit(1)
console.log('season mark ok')
