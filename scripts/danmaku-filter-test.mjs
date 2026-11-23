// 弹幕屏蔽规则：听歌舞台与观看页共用同一份实现，这里直接测它。
import { filterDanmaku } from '../apps/desktop/src/features/player/danmakuFilter.ts'

let failed = 0
function check(name, ok) {
  if (ok) console.log(`ok   ${name}`)
  else {
    failed += 1
    console.error(`FAIL ${name}`)
  }
}

const item = (text, mode = 1) => ({ at: 0, text, color: '#fff', mode })
const list = [item('前方高能'), item('前方高能!'), item('顶部同句', 5), item('底部同句', 4)]

check('没有条件时原样返回同一数组', filterDanmaku(list, [], []) === list)
check('空白屏蔽词不算条件', filterDanmaku(list, ['  '], []) === list)

const byWord = filterDanmaku(list, [' 前方高能'], [])
check('屏蔽词去掉首尾空格后按子串匹配', byWord.length === 2 && byWord.every((x) => !x.text.includes('前方高能')))
check('标点差异不影响子串命中', !byWord.some((x) => x.text === '前方高能!'))

const upper = filterDanmaku([item('GG')], ['gg'], [])
check('大小写不敏感', upper.length === 0)

const byType = filterDanmaku(list, [], ['top'])
check('按类型屏蔽顶部', byType.length === 3 && !byType.some((x) => x.mode === 5))
const byBottom = filterDanmaku(list, [], ['bottom'])
check('按类型屏蔽底部', byBottom.length === 3 && !byBottom.some((x) => x.mode === 4))
const byRoll = filterDanmaku(list, [], ['roll'])
check('按类型屏蔽滚动', byRoll.length === 2 && byRoll.every((x) => x.mode === 4 || x.mode === 5))

const both = filterDanmaku(list, ['高能'], ['top'])
check('词与类型同时生效', both.length === 1 && both[0].mode === 4)

if (failed > 0) process.exit(1)
console.log('danmaku filter ok')
