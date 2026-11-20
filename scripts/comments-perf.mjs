// 评论长列表性能门禁。用 dev 预览的 ?manyComments=1 夹具造 1000 条 200 字评论，
// 滚到底后检查布局次数。离屏评论若每一条都克隆正文测量，会把这些数字打回 6000+。
//
// 用法：先 npm run web（1420），再 node scripts/comments-perf.mjs。
import { spawn } from 'node:child_process'

const WEB = 'http://127.0.0.1:1420/?manyComments=1'
const PORT = 9237
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const LAYOUT_LIMIT = 2000
const HEAP_LIMIT = 100 * 1024 * 1024
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function reachable(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function main() {
  if (!(await reachable('http://127.0.0.1:1420/'))) {
    console.log('dev 服务器没起：先跑 npm run web')
    process.exitCode = 1
    return
  }

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      '--user-data-dir=/tmp/oh-bilibili-comments-perf',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let version = null
  for (let i = 0; i < 40 && !version; i += 1) {
    await sleep(250)
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch {
      // 还没起来
    }
  }
  if (!version) {
    chrome.kill()
    throw new Error('无头 Chrome 起不来')
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const done = message.id ? pending.get(message.id) : null
    if (!done) return
    pending.delete(message.id)
    done(message)
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
    })

  try {
    const target = await send('Target.createTarget', { url: 'about:blank' })
    const attached = await send('Target.attachToTarget', {
      targetId: target.result.targetId,
      flatten: true,
    })
    const sid = attached.result.sessionId
    await send('Runtime.enable', {}, sid)
    await send('Performance.enable', {}, sid)
    await send(
      'Emulation.setDeviceMetricsOverride',
      { width: 1320, height: 1000, deviceScaleFactor: 1, mobile: false },
      sid,
    )
    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid))
        .result?.result?.value

    await evaluate(`location.href = ${JSON.stringify(WEB)}`)
    await sleep(6000)
    await evaluate(`(() => {
      const card = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '').startsWith('观看'))
      if (card) card.click()
    })()`)
    let hasVideo = false
    for (let i = 0; i < 30 && !hasVideo; i += 1) {
      await sleep(500)
      hasVideo = await evaluate(`!!document.querySelector('video')`)
    }
    if (!hasVideo) throw new Error('没有进入观看页')
    await sleep(3000)

    await evaluate(`window.__longTasks = []
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__longTasks.push(entry.duration)
        }).observe({ entryTypes: ['longtask'] })
      } catch {}`)

    let count = 0
    for (let i = 0; i < 90; i += 1) {
      await evaluate(`(() => {
        const el = document.getElementById('scroll-main')
        if (!el) return 0
        el.scrollTop = el.scrollHeight
        return el.scrollTop
      })()`)
      await sleep(220)
      count = await evaluate(`document.querySelectorAll('[data-comment-id]').length`)
      if (count >= 1000) break
    }

    const expandButtons = await evaluate(
      `[...document.querySelectorAll('[data-comment-id] button')].filter((b) => (b.textContent || '').trim() === '展开').length`,
    )
    const longTasks = await evaluate(`window.__longTasks ?? []`)
    const metrics = (await send('Performance.getMetrics', {}, sid)).result.metrics
    const metric = (name) => metrics.find((m) => m.name === name)?.value ?? 0
    const report = {
      comments: count,
      layouts: metric('LayoutCount'),
      recalcStyles: metric('RecalcStyleCount'),
      nodes: metric('Nodes'),
      heapMB: Math.round((metric('JSHeapUsedSize') / 1024 / 1024) * 10) / 10,
      expandButtons,
      longTasks: longTasks.length,
      longMax: longTasks.length ? Math.round(Math.max(...longTasks)) : 0,
    }
    console.log(report)

    if (count < 1000) {
      console.log(`✗ 只加载了 ${count} 条评论`)
      process.exitCode = 1
    } else if (report.layouts >= LAYOUT_LIMIT) {
      console.log(`✗ 布局次数 ${report.layouts} 超过上限 ${LAYOUT_LIMIT}`)
      process.exitCode = 1
    } else if (metric('JSHeapUsedSize') >= HEAP_LIMIT) {
      console.log(`✗ JS 堆 ${report.heapMB}MB 超过上限 ${Math.round(HEAP_LIMIT / 1024 / 1024)}MB`)
      process.exitCode = 1
    } else if (report.expandButtons === 0) {
      console.log('✗ 长评论的「展开」按钮没有出现')
      process.exitCode = 1
    } else {
      console.log('✓ 评论长列表布局与堆占用在预算内')
    }
  } finally {
    ws.close()
    chrome.kill()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
