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
const strip = scheduleDanmaku(
  [line(1000), line(1500), line(1600, '顶部', 5), line(10000, '底部', 4), line(10100), line(14000)],
  true, 1, life,
)
assert.deepEqual(counts(strip, 1600), [2])
assert.deepEqual(visibleDanmaku(strip, 10000, life).map(({ flight }) => flight.mode), [4])
assert.deepEqual(counts(strip, 13999), [1])
assert.deepEqual(counts(strip, 14000), [1])
const own = { ...line(3500, '我刚发的弹幕'), own: true }
const withOwn = scheduleDanmaku([line(1000), own, line(4000)], false, 1, life)
assert.deepEqual(visibleDanmaku(withOwn, 3499, life).map(({ flight }) => flight.text), ['前方高能'])
assert.deepEqual(visibleDanmaku(withOwn, 3500, life).map(({ flight }) => flight.text), [own.text])
const crowded = scheduleDanmaku([line(0), line(15, '独特'), line(500), line(580, '独特'), line(1490, '独特')], true, 1, life)
assert.deepEqual(counts(crowded, 1490), [2])
const burst = scheduleDanmaku([
  line(0, '滚动'), line(0, '底部', 4), line(0, '顶部', 5),
  line(100, '太挤了', 5), line(1450, '这条很长的滚动弹幕不会追上前一条'),
  line(4000, '新的底部', 4), line(4000, '新的顶部', 5), line(9000, '再滚动'),
], false, 3, life)
const rows = (plan, ms) => visibleDanmaku(plan, ms, life).map(({ flight }) => [flight.text, flight.lane])
assert.deepEqual(rows(burst, 1450), [['滚动', 0], ['底部', 2], ['顶部', 1]])
assert.deepEqual(rows(burst, 4000), [['滚动', 0], ['新的底部', 2], ['新的顶部', 1]])
assert.deepEqual(rows(burst, 9000), [['再滚动', 0]])
const ownPinned = scheduleDanmaku([line(0), line(0, '底部', 4), { ...line(300, '自己发送', 4), own: true }], false, 2, life)
assert.deepEqual(rows(ownPinned, 300), [['前方高能', 0], ['自己发送', 1]])
const variants = [line(100), line(200, '前方高能！'), line(210, '前方高能', 4), line(220, '前方高能', 1, '#ddd'), line(230)]
assert.deepEqual(counts(scheduleDanmaku(variants, true, 5, life), 230), [2, 1, 1, 1])
assert.deepEqual(counts(scheduleDanmaku(records, false, 5, life), 11900), [1, 1, 1])
assert.deepEqual(counts(scheduleDanmaku([line(12000)], true, 2, life), 11900), [])
assert.deepEqual(withLocalEchoes([line(0), line(0)], [line(0), line(25)]), [line(0), line(0), line(25)])
assert.deepEqual(withLocalEchoes([line(0)], [line(0), line(0)]), [line(0), line(0)])
console.log('danmaku merge ok')
