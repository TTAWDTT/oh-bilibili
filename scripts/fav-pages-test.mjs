// 收藏夹全集读取的回归：用可控的分页响应跑真实模块。
import { collectFavTracks } from '../apps/desktop/src/features/library/favPages.ts'

let failed = 0
function check(name, ok) {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL ${name}`)
}

const track = (key) => ({ key, title: key, artist: '', duration_ms: 60_000, cover: null })
const pageOf = (from, count) =>
  Array.from({ length: count }, (_, i) => track(`BV${String(from + i).padStart(4, '0')}`))
const pages = (map) => async (page) => {
  const value = map[page]
  if (value instanceof Error) throw value
  return value ?? []
}

{
  const r = await collectFavTracks(pages({ 1: pageOf(0, 40), 2: pageOf(40, 40), 3: pageOf(80, 15) }), {
    expected: 95,
  })
  check('三页读完正好 95 项且顺序不变', r.tracks.length === 95 && r.complete)
  check('第一项与最后一项没有错位', r.tracks[0].key === 'BV0000' && r.tracks[94].key === 'BV0094')
}

{
  const r = await collectFavTracks(pages({ 1: [] }), { expected: 0 })
  check('空夹读完是空列表且算完成', r.tracks.length === 0 && r.complete)
}

{
  const r = await collectFavTracks(pages({ 1: pageOf(0, 40), 2: pageOf(0, 40) }), { expected: 95 })
  check('重复页不会无限翻', r.tracks.length === 40 && r.complete === false)
}

{
  let threw = false
  try {
    await collectFavTracks(pages({ 1: pageOf(0, 40), 2: new Error('timeout') }), { expected: 95 })
  } catch {
    threw = true
  }
  check('中途失败会抛出，交给调用方放弃播放', threw)
}

{
  let calls = 0
  const r = await collectFavTracks(
    async (page) => {
      calls += 1
      return pageOf(calls * 100, 40)
    },
    { expected: 500, stopped: () => calls >= 2 },
  )
  check('取消后只多取一页就停', calls === 2 && r.complete === false)
  check('取消时带回已读到的部分', r.tracks.length === 40)
}

{
  const progress = []
  await collectFavTracks(pages({ 1: pageOf(0, 40), 2: pageOf(40, 10) }), {
    expected: 50,
    onProgress: (loaded, page) => progress.push(`${page}:${loaded}`),
  })
  check('进度按页报告已读数量', progress.join(',') === '1:40,2:50')
}

{
  const r = await collectFavTracks(pages({ 1: pageOf(0, 40), 2: pageOf(40, 40) }), {
    expected: 999,
    maxPages: 2,
  })
  check('达到页数上限时不假装读全', r.tracks.length === 80 && r.complete === false)
}

if (failed > 0) process.exit(1)
console.log('fav pages ok')
