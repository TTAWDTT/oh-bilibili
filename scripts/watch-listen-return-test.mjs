import assert from 'node:assert/strict'
import { useAppStore } from '../apps/desktop/src/app/appStore.ts'

const store = () => useAppStore.getState()
const watch = (key) => ({ kind: 'watch', track: { key, title: key, artist: '', cover: null, duration_ms: 30000 } })
const results = { kind: 'search', query: '爵士乐' }
store().navigate(results)
store().navigate(watch('B'), undefined, 'card-B')
store().navigate(watch('A'))
store().goBack()
assert.equal(store().view.track.key, 'B', '普通返回仍回到上一个视频')
store().navigate(watch('A'))
store().returnAfterListening()
assert.deepEqual(store().view, results)
assert.equal(store().currentQuery, '爵士乐')
assert.deepEqual(store().returnFocus, { kind: 'search', id: 'card-B' })
assert.deepEqual(store().history.map((entry) => entry.view.kind), ['home'])

useAppStore.setState({ history: [], view: watch('B') })
store().navigate(watch('A'))
store().returnAfterListening()
assert.deepEqual(store().view, { kind: 'home' })
assert.equal(store().history.length, 0)
console.log('watch to listen return ok')
