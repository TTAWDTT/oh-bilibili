// 简介出处解析的回归断言：直接用 Node 的类型剥离跑真实模块（Node >= 22.6）。
import { parseSources } from '../apps/desktop/src/features/watch/sources.ts'

let failed = 0
function check(name, ok) {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL ${name}`)
}

const sample = `==《大喜》==
伴奏、歌词、模型及动作数据，前往二创页面下载：
https://www.bilibili.com/blackboard/live/activity-2lCSeu8PQ.html
————————————`
const pair = parseSources(sample, 'BV1Ri4y1T7md')
check('跨行关系词配唯一链接成一个条目', pair.length === 1 && pair[0].kind === 'external')
check('关系词按原文顺序且不拆动作数据', pair[0]?.relations.join('、') === '伴奏、歌词、模型、动作数据、下载')

const same = parseSources('原舞：https://www.bilibili.com/video/BV1Mk4y11666', 'BV1xx411c7mD')
check('同一行的 BV 识别为站内作品', same.length === 1 && same[0].kind === 'video' && same[0].bvid === 'BV1Mk4y11666')

check('一行多个链接跳过', parseSources('参考 https://a.com/x https://b.com/y', 'BV1xx411c7mD').length === 0)
check('纯链接行忽略', parseSources('https://a.com/x', 'BV1xx411c7mD').length === 0)
check('指向本稿的链接跳过', parseSources('原舞：BV1xx411c7mD', 'BV1xx411c7mD').length === 0)
check('重复条目去重', parseSources('伴奏：https://a.com/x\n伴奏：https://a.com/x', 'BV1xx411c7mD').length === 1)

if (failed > 0) {
  console.error(`sources: ${failed} failed`)
  process.exit(1)
}
console.log('sources: all passed')
