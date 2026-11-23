// 分 P 书脊的文案与断点判定：用真实模块跑断言。
import { spineLabel } from '../apps/desktop/src/features/tracks/pageSpineLabel.ts'

let failed = 0
function check(name, ok) {
  if (ok) console.log(`ok   ${name}`)
  else {
    failed += 1
    console.error(`FAIL ${name}`)
  }
}

check('没有分 P 数时不显示', spineLabel(undefined, null) === null)
check('单 P 不显示', spineLabel(1, null) === null)
check('P0 不显示', spineLabel(0, null) === null)
check('多 P 只写数量', spineLabel(8, null) === '8 P')
check('有断点写成 P3 / 8', spineLabel(8, 3) === 'P3 / 8')
check('断点超出分 P 数时退回数量', spineLabel(8, 9) === '8 P')
check('断点为 0 时退回数量', spineLabel(8, 0) === '8 P')

if (failed > 0) process.exit(1)
console.log('page spine ok')
