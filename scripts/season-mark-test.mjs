// 合集书脊标记：用真实模块跑断言，覆盖稿数去重与损坏数据。
import { seasonLabel } from '../apps/desktop/src/features/tracks/seasonMark.ts'

let failed = 0
function check(name, ok) {
  if (ok) console.log(`ok   ${name}`)
  else {
    failed += 1
    console.error(`FAIL ${name}`)
  }
}

check('没有标记不显示', seasonLabel(null) === null)
check('有稿数写「合集 · N 稿」', seasonLabel({ id: 1, title: '收藏', count: 12 }) === '合集 · 12 稿')
check('稿数为 0 时退回「合集」', seasonLabel({ id: 1, title: '收藏', count: 0 }) === '合集')
check('单稿合集仍按稿数写', seasonLabel({ id: 1, title: '收藏', count: 1 }) === '合集 · 1 稿')

if (failed > 0) process.exit(1)
console.log('season mark ok')
