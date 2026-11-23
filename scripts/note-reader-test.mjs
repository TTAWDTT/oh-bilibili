// 「边看边读」的句子切分：用真实模块跑断言。
import { findCommentTimes } from '../apps/desktop/src/features/watch/commentTime.ts'
import { noteSentence } from '../apps/desktop/src/features/watch/noteSentence.ts'

let failed = 0
function check(name, ok) {
  if (ok) console.log(`ok   ${name}`)
  else {
    failed += 1
    console.error(`FAIL ${name}`)
  }
}

const text = 'P2 00:12 花絮从这里开始；P1 00:05 是正片的高能段。'
const anchors = findCommentTimes(text, 3)
check('两个时间点各自成句', noteSentence(text, anchors[0]) === '花絮从这里开始')
check('第二句不带 P1 前缀与时间', noteSentence(text, anchors[1]) === '是正片的高能段。')

const multiline = 'P2\n03:20 前奏\n04:10 副歌'
const grouped = findCommentTimes(multiline, 3)
check('分组下面的条目各取所在行', noteSentence(multiline, grouped[1]) === '副歌')

const onlyTime = '03:20'
check('只有时间点时退回占位文案', noteSentence(onlyTime, findCommentTimes(onlyTime, 1)[0]) === '')

if (failed > 0) process.exit(1)
console.log('note reader ok')
