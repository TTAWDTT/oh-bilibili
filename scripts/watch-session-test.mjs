// 连续观看片单的状态机回归：直接用 Node 的类型剥离跑真实模块。
import {
  advanceWatchSession,
  currentWatchSession,
  endWatchSession,
  peekWatchSessionNext,
  skipWatchSession,
  startWatchSession,
} from '../apps/desktop/src/features/watch/watchSession.ts'

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
const [a, b, c] = ['A', 'B', 'C'].map(track)

startWatchSession([a, b, c], 0)
check('开始时当前条目就是传入下标', currentWatchSession('A') !== null)
check('预告的下一条是 B', peekWatchSessionNext('A')?.key === 'B')
check('预告不推进会话', currentWatchSession('A') !== null)

check('走到下一条返回 B', advanceWatchSession('A')?.key === 'B')
check('B 成为当前条目', currentWatchSession('B') !== null)
check('A 不再是当前条目', currentWatchSession('A') === null)

check('跳过 B 直接到 C', skipWatchSession('B')?.key === 'C')
check('C 是最后一条，没有下一条', peekWatchSessionNext('C') === null)
check('最后一条再往后为空', advanceWatchSession('C') === null)

endWatchSession()
check('结束后没有当前条目', currentWatchSession('C') === null)

startWatchSession([a, b], 0)
check('只剩两条时跳过 A 直接到 B', skipWatchSession('A')?.key === 'B')
check('B 成为当前条目', currentWatchSession('B') !== null)
check('最后一条没有下一条', peekWatchSessionNext('B') === null)

endWatchSession()
if (failed > 0) process.exit(1)
console.log('watch session ok')
