import assert from 'node:assert/strict'
import { collectFavTracks } from '../apps/desktop/src/features/library/favPages.ts'

const tracks = (start, count) => Array.from({ length: count }, (_, i) => ({ key: `BV${start + i}` }))
const page = (start, count, has_more) => ({ tracks: tracks(start, count), has_more })
const initial = tracks(0, 40)
const fetched = []
const progress = []
const result = await collectFavTracks(async (n) => {
  fetched.push(n)
  return n === 2 ? page(40, 40, true) : page(80, 15, false)
}, { initial, fromPage: 2, onProgress: (rows, n, done) => progress.push([n, rows.length, done]) })
assert.deepEqual(fetched, [2, 3])
assert.deepEqual(result, { tracks: tracks(0, 95), complete: true })
assert.deepEqual(progress, [[2, 80, false], [3, 95, true]])

assert.deepEqual(await collectFavTracks(async () => page(0, 0, false)), { tracks: [], complete: true })
assert.deepEqual(await collectFavTracks(async (n) => n === 1 ? page(0, 39, true) : page(38, 4, false)),
  { tracks: tracks(0, 42), complete: true })
assert.deepEqual(await collectFavTracks(async (n) => n === 1 ? page(0, 0, true) : page(0, 3, false)),
  { tracks: tracks(0, 3), complete: true })
assert.deepEqual(await collectFavTracks(async () => page(0, 40, true)),
  { tracks: initial, complete: false })

let lastPage = 1
let loaded = initial
await assert.rejects(collectFavTracks(async (n) => {
  if (n === 3) throw Error('timeout')
  return page(40, 40, true)
}, { initial, fromPage: 2, onProgress: (rows, n) => { loaded = rows; lastPage = n } }), /timeout/)
const resumed = await collectFavTracks(async (n) => {
  assert.equal(n, 3)
  return page(80, 15, false)
}, { initial: loaded, fromPage: lastPage + 1 })
assert.deepEqual(resumed, result)

let stop = false
const canceled = await collectFavTracks(async () => {
  stop = true
  return page(40, 4, false)
}, { initial, fromPage: 2, stopped: () => stop, onProgress: () => assert.fail('取消后的请求更新了列表') })
assert.deepEqual(canceled, { tracks: initial, complete: false })
console.log('fav pages ok')
