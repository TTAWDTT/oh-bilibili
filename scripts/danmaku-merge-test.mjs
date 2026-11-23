import assert from 'node:assert/strict'
import { scheduleDanmaku, visibleDanmaku, withLocalEchoes } from '../apps/desktop/src/features/player/danmakuMerge.ts'

const line = (at, text = '前方高能', mode = 1, color = '#fff') => ({ at, text, mode, color })
const records = [line(10000), line(10800), line(11900), line(12000)]
const life = 9000
const timeline = scheduleDanmaku(records, true, 3, life)
const counts = (plan, ms) => visibleDanmaku(plan, ms, life).map((row) => row.count)
assert.deepEqual(counts(timeline, 9999), [])
assert.deepEqual(counts(timeline, 10000), [1])
assert.deepEqual(counts(timeline, 10800), [2])
assert.deepEqual(counts(timeline, 11900), [3])
assert.deepEqual(counts(timeline, 12000), [3, 1])
assert.deepEqual(counts(timeline, 10800), [2])
assert.deepEqual(counts(timeline, 10800), [2])
assert.deepEqual(counts(scheduleDanmaku([line(0), line(0)], true, 1, life), 0), [2])
const crowded = scheduleDanmaku([line(0), line(15, '独特'), line(500), line(580, '独特'), line(1490, '独特')], true, 1, life)
assert.deepEqual(counts(crowded, 1490), [2])
const variants = [line(100), line(200, '前方高能！'), line(210, '前方高能', 4), line(220, '前方高能', 1, '#ddd'), line(230)]
assert.deepEqual(counts(scheduleDanmaku(variants, true, 5, life), 230), [2, 1, 1, 1])
assert.deepEqual(counts(scheduleDanmaku(records, false, 5, life), 11900), [1, 1, 1])
assert.deepEqual(counts(scheduleDanmaku([line(12000)], true, 2, life), 11900), [])
assert.deepEqual(withLocalEchoes([line(0), line(0)], [line(0), line(25)]), [line(0), line(0), line(25)])
assert.deepEqual(withLocalEchoes([line(0)], [line(0), line(0)]), [line(0), line(0)])
console.log('danmaku merge ok')
