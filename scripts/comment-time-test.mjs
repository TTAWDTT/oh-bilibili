// 评论时间点的分 P 解析：直接用 Node 的类型剥离跑真实模块。
import { findCommentTimes } from '../apps/desktop/src/features/watch/commentTime.ts'

const pages = [1, 2, 3].map((no) => ({ no, duration_ms: 4_000_000 }))

let failed = 0
function check(name, ok) {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL ${name}`)
}

const same = findCommentTimes('P2 03:20', pages)
check('P2 03:20 认出分 P 与毫秒', same.length === 1 && same[0].page === 2 && same[0].ms === 200_000)
check('按钮覆盖「P2 03:20」整段', same[0].start === 0 && same[0].end === 8)
check('存在的 P 不算无效', same[0].invalid === false)

const two = findCommentTimes('先看 P1 03:20，再看 P2 04:10', pages)
check('同一行两个 P 各归各的', two.length === 2 && two[0].page === 1 && two[1].page === 2)
check('第二个按钮只包自己那句', two[1].start === 15 && two[1].end === 23)

const grouped = findCommentTimes('P2\n03:20\n04:10\nP3\n05:00', pages)
check('分组标题约束下面两条', grouped.length === 3 && grouped[0].page === 2 && grouped[1].page === 2)
check('下一个分组标题接管', grouped[2].page === 3)
check('分组里的按钮只包时间本身', grouped[0].start === 3 && grouped[0].end === 8)

const lone = findCommentTimes('03:20 这里', pages)
check('没写分 P 时留给调用方', lone.length === 1 && lone[0].page === null && lone[0].invalid === false)

const missing = findCommentTimes('P9 03:20', pages)
check('不存在的 P 不自动跳', missing[0].page === null && missing[0].invalid === true)

const conflict = findCommentTimes('P1 P2 03:20', pages)
check('同一行两个 P 视为冲突', conflict[0].invalid === true)

const zero = findCommentTimes('P0 03:20', pages)
check('P0 也不自动跳', zero[0].invalid === true)

const nested = findCommentTimes('简介（P2 1:02:03）', pages)
check('括号里的 P 标记也认', nested[0].page === 2 && nested[0].ms === 3_723_000)

const single = findCommentTimes('P2 03:20', pages.slice(0, 1))
check('单 P 稿里的 P2 不可跳', single[0].invalid === true)

const shortPages = [{ no: 1, duration_ms: 200_000 }, { no: 2, duration_ms: 180_000 }]
const boundary = findCommentTimes('P1 03:20；P2 03:20', shortPages)
check('目标页结尾可到达，超过该页时长只读', !boundary[0].invalid && boundary[1].invalid)
const other = 'https://www.bilibili.com/video/BV2test/?p=2&t=120'
const own = 'https://www.bilibili.com/video/BV1test/?p=2&t=120'
const links = findCommentTimes(`${other} 原出处\n${own} 当前演示`, shortPages, 'BV1test')
check('他稿链接保留引用，本稿链接解析页与秒', links.length === 1 && links[0].page === 2 && links[0].ms === 120_000)
check('文字页号与链接页号冲突时不可跳', findCommentTimes(`P1 ${own}`, shortPages, 'BV1test')[0].invalid)
check('夹有表情、提及的分组使用同一个完整原文', findCommentTimes('P2\n[笑] @老师 00:10', shortPages)[0].page === 2)
check('单 P 无页码标记可直接定位', findCommentTimes('00:10', shortPages.slice(0, 1))[0].page === 1)

if (failed > 0) process.exit(1)
console.log('comment time ok')
