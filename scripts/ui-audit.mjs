#!/usr/bin/env node
/**
 * 浅色主题一致性检查。
 *
 * 从深色主题切浅色时，CSS 变量跟着变了，但组件里写死的值不会。
 * 典型症状：悬停时文字消失、弹窗是黑的、深色遮罩上写深色字。
 *
 * 只报「确定是错」的组合，不报「可能有问题」的写法，这样退出码 0/1 就可信。
 * 覆盖在图片或视频上的深色遮罩（时长角标、播放遮罩、视频浮层）是合法的，
 * 它们出现在 DARK_CONTEXT_FILES 里的文件时会被跳过。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../apps/desktop/src', import.meta.url).pathname

// 这些文件整体是深色语境（全屏视频浮层、banner 深色遮罩），浅色字合法
const DARK_CONTEXT_FILES = [
  // 观看页的提示文字压在视频画面上，底色是黑的
  'features/watch/WatchView.tsx',
  'features/search/SearchBanner.tsx',
]

// 封面上的字母字画在图片上，白色是对的，不参与浅色主题检查
const ON_IMAGE_PROPS = ['glyphClassName']

const RULES = [
  {
    name: '深底 + 深字（文字完全不可见）',
    re: /bg-black\/\d+[^"'`]*text-\[var\(--text-[123]\)\]/,
    skipDarkContext: false,
    hint: '深色遮罩上用了深色文字，改用 text-white',
  },
  {
    name: 'hover:text-white（浅色底上悬停即消失）',
    re: /hover:text-white\b/,
    skipDarkContext: true,
    hint: '改用 hover:text-[var(--text-1)]',
  },
  {
    name: '深色卡片底（深色主题遗留）',
    re: /bg-\[#0[0-9a-f]{5}\]/,
    skipDarkContext: false,
    hint: '改用 var(--panel)',
  },
  {
    name: '半透明白字（只可能出现在深色底上）',
    re: /text-white\/\d+/,
    skipDarkContext: true,
    hint: '浅色界面上读不到；图片/视频上的文字属于 DARK_CONTEXT 或加 ui-audit-ok',
  },
  {
    name: '白描边（浅色底上看不见）',
    re: /border-white\/\d+/,
    skipDarkContext: true,
    hint: '改用 var(--line) 或强调色；图片上的描边可保留',
  },
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p)
  }
  return out
}

const findings = []
for (const file of walk(ROOT)) {
  const rel = file.replace(ROOT + '/', '')
  const darkContext = DARK_CONTEXT_FILES.includes(rel)
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const rule of RULES) {
    if (darkContext && rule.skipDarkContext) continue
    lines.forEach((line, i) => {
      rule.re.lastIndex = 0
      if (!rule.re.test(line)) return
      // 封面上的字母字画在图片上；行内标记可以显式放过
      const marked =
        line.includes('ui-audit-ok') ||
        (i > 0 && lines[i - 1].includes('ui-audit-ok')) ||
        ON_IMAGE_PROPS.some((prop) => line.includes(prop))
      if (marked) return
      findings.push({ file: rel, line: i + 1, rule: rule.name, hint: rule.hint, snippet: line.trim().slice(0, 96) })
    })
  }
}

if (findings.length === 0) {
  console.log('✓ 没有发现深色主题遗留')
  process.exit(0)
}

console.log(`发现 ${findings.length} 处：\n`)
let last = ''
for (const f of findings) {
  if (f.rule !== last) {
    console.log(`── ${f.rule}\n   ${f.hint}`)
    last = f.rule
  }
  console.log(`   ${f.file}:${f.line}  ${f.snippet}`)
}
process.exit(1)
