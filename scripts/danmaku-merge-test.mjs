// 弹幕同句合并的时间窗与组长失效：用真实模块跑断言。
import { DanmakuMergeGroups, MERGE_WINDOW_MS } from '../apps/desktop/src/features/player/danmakuMerge.ts'

let failed = 0
function check(name, ok) {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL ${name}`)
}

const groups = new DanmakuMergeGroups()
groups.remember('前方高能', 10_000, 1)

check('窗口内第一条重复并到组长', groups.leaderFor('前方高能', 10_800, new Set([1])) === 1)
check('窗口末尾仍算同一组', groups.leaderFor('前方高能', 10_000 + MERGE_WINDOW_MS - 1, new Set([1])) === 1)
check('到窗口终点另起一组', groups.leaderFor('前方高能', 10_000 + MERGE_WINDOW_MS, new Set([1])) === null)
check('更早的时间不会并入', groups.leaderFor('前方高能', 9_900, new Set([1])) === null)
check('不同文本各算各的', groups.leaderFor('前方高能！', 10_500, new Set([1])) === null)
check('组长已经被清理就不并入', groups.leaderFor('前方高能', 10_500, new Set()) === null)

groups.forget(1)
check('摘掉组长后同句不再并入', groups.leaderFor('前方高能', 10_500, new Set([1])) === null)

groups.remember('再来一次', 20_000, 7)
check('第二条同句不会延长窗口', groups.leaderFor('再来一次', 21_900, new Set([7])) === 7)
check('窗口仍按第一条起算', groups.leaderFor('再来一次', 22_000, new Set([7])) === null)

groups.clear()
check('清空后没有任何组', groups.leaderFor('再来一次', 20_100, new Set([7])) === null)

if (failed > 0) process.exit(1)
console.log('danmaku merge ok')
