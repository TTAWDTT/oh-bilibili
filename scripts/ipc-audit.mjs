#!/usr/bin/env node
// 检查前端能调的命令都真的注册在 Tauri 里。
//
// 这类问题在浏览器预览里完全看不出来（走的是 mock），只有真机点下去才会
// 报「命令不存在」。之前 UserHitView 少字段就是这么漏出去的，所以加一道静态闸门。
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const ipcSrc = fs.readFileSync(path.join(root, 'apps/desktop/src/shared/lib/ipc.ts'), 'utf8')
const libSrc = fs.readFileSync(path.join(root, 'apps/desktop/src-tauri/src/lib.rs'), 'utf8')

const called = new Set([...ipcSrc.matchAll(/call<[^>]*>\('([a-z0-9_]+)'/g)].map((m) => m[1]))
const handlerBlock = libSrc.match(/generate_handler!\[([\s\S]*?)\]/)
if (!handlerBlock) {
  console.error('✗ 找不到 generate_handler! 列表：lib.rs 结构变了？')
  process.exit(1)
}
const registered = new Set([...handlerBlock[1].matchAll(/([a-z0-9_]+)\s*,/g)].map((m) => m[1]))

const missing = [...called].filter((name) => !registered.has(name)).sort()
if (missing.length > 0) {
  console.error(`✗ 前端调用了没注册的命令：${missing.join(', ')}`)
  console.error('  在 apps/desktop/src-tauri/src/lib.rs 的 generate_handler! 里补上，否则真机会报「命令不存在」。')
  process.exit(1)
}

const mockSrc = fs.readFileSync(path.join(root, 'apps/desktop/src/shared/lib/mock.ts'), 'utf8')
const mocked = new Set([...mockSrc.matchAll(/case '([a-z0-9_]+)'/g)].map((m) => m[1]))
// queue_* / player_* 由 mockPlayer 按前缀统一接掉，不在 switch 的 case 列表里。
const unmocked = [...called]
  .filter((name) => !mocked.has(name) && !/^(player_|queue_)/.test(name))
  .sort()

console.log(`✓ ${called.size} 个命令都已注册${unmocked.length > 0 ? `；预览未 mock：${unmocked.join(', ')}` : '，且都有 mock'}`)
