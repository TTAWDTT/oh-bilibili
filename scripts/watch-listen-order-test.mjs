import assert from 'node:assert/strict'
import * as watch from '../apps/desktop/src/features/watch/watchSession.ts'

const track = (key) => ({ key, title: key, artist: 'UP', cover: null, duration_ms: 90000 })
const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(track)
const season = [a, b, c].map((t) => ({ ...t, current: t.key === 'B', views: 10 }))
const after = (key) => watch.followingWatchTracks(key, season, 'UP').map((item) => item.key)

assert.deepEqual(after('B'), ['C'], '听视频应从当前合集条目往后接')
assert.deepEqual(after('D'), [], '当前稿不属于合集时没有合集后续')
watch.startWatchSession([a, b, d], 1)
assert.deepEqual(after('B'), ['D'], '片单的下一稿优先于投稿所属的合集')
assert.equal(watch.currentWatchSession('B').index, 1, '生成听队列不应改变观看位置')
watch.startWatchSession([a, b], 1)
assert.deepEqual(after('B'), [], '片单末尾不应串进别的合集')
watch.endWatchSession()
console.log('watch to listen order ok')
