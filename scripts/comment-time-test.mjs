// 评论时间点的分 P 解析：直接用 Node 的类型剥离跑真实模块。
import { findCommentTimes } from '../apps/desktop/src/features/watch/commentTime.ts'

let failed = 0
function check(name, ok) {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL ${name}`)
}

const same = findCommentTimes('P2 03:20', 3)
check('P2 03:20 认出分 P 与毫秒', same.length === 1 && same[0].page === 2 && same[0].ms === 200_000)
check('按钮覆盖「P2 03:20」整段', same[0].start === 0 && same[0].end === 8)
check('存在的 P 不算无效', same[0].invalid === false)

const two = findCommentTimes('先看 P1 03:20，再看 P2 04:10', 3)
check('同一行两个 P 各归各的', two.length === 2 && two[0].page === 1 && two[1].page === 2)
check('第二个按钮只包自己那句', two[1].start === 15 && two[1].end === 23)

const grouped = findCommentTimes('P2\n03:20\n04:10\nP3\n05:00', 3)
check('分组标题约束下面两条', grouped.length === 3 && grouped[0].page === 2 && grouped[1].page === 2)
check('下一个分组标题接管', grouped[2].page === 3)
check('分组里的按钮只包时间本身', grouped[0].start === 3 && grouped[0].end === 8)

const lone = findCommentTimes('03:20 这里', 3)
check('没写分 P 时留给调用方', lone.length === 1 && lone[0].page === null && lone[0].invalid === false)

const missing = findCommentTimes('P9 03:20', 3)
check('不存在的 P 不自动跳', missing[0].page === null && missing[0].invalid === true)

const conflict = findCommentTimes('P1 P2 03:20', 3)
check('同一行两个 P 视为冲突', conflict[0].invalid === true)

const zero = findCommentTimes('P0 03:20', 3)
check('P0 也不自动跳', zero[0].invalid === true)

const nested = findCommentTimes('简介（P2 1:02:03）', 3)
check('括号里的 P 标记也认', nested[0].page === 2 && nested[0].ms === 3_723_000)

const single = findCommentTimes('P2 03:20', 1)
check('单 P 稿里的 P2 不可跳', single[0].invalid === true)

if (failed > 0) process.exit(1)
console.log('comment time ok')
