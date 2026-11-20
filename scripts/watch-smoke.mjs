// 观看页面板冒烟：用无头 Chrome 打开 dev 服务器上的页面，挨个点开
// 分享 / 弹幕列表 / 弹幕设置，确认面板真的出来了。
//
// 用法：先 `npm run web`（1420），再 `node scripts/watch-smoke.mjs`。
// 它不依赖真机窗口，锁屏时也能跑；视觉与真机验收仍然要在 app 里做。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const WEB = 'http://127.0.0.1:1420/'
const PORT = 9224
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function reachable(url) {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

/** 极简 CDP 客户端：只需要「开页面、执行表达式」。 */
async function connect() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      '--user-data-dir=/tmp/oh-bilibili-smoke',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
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
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const done = msg.id ? pending.get(msg.id) : null
    if (done) {
      pending.delete(msg.id)
      done(msg)
    }
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((res) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
    })

  const target = await send('Target.createTarget', { url: 'about:blank' })
  const attached = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true })
  const sid = attached.result.sessionId
  await send('Runtime.enable', {}, sid)
  await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 900, deviceScaleFactor: 1, mobile: false }, sid)

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)
    return res.result?.result?.value
  }
  /** 精确匹配按钮文字：评论里也有「UP主」徽标，includes 会点错。 */
  const clickExactText = (text) =>
    evaluate(`(() => {
      const hit = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === ${JSON.stringify(text)})
      if (!hit) return false
      hit.click()
      return true
    })()`)
  const clickText = (needle) =>
    evaluate(`(() => {
      const hit = [...document.querySelectorAll('button,[role="button"]')].find((node) =>
        ((node.getAttribute('aria-label') || '') + node.textContent || '').includes(${JSON.stringify(needle)}))
      if (!hit) return false
      hit.click()
      return true
    })()`)

  return {
    evaluate,
    clickText,
    clickExactText,
    close: () => {
      ws.close()
      chrome.kill()
    },
  }
}

const checks = []
function check(name, ok) {
  checks.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}`)
}

async function main() {
  if (!existsSync(CHROME)) {
    console.log('没装 Chrome，跳过')
    return
  }
  if (!(await reachable(WEB))) {
    console.log('dev 服务器没起：先跑 npm run web')
    process.exitCode = 1
    return
  }

  const page = await connect()
  try {
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    await sleep(6000)
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '').startsWith('观看'))
      if (card) card.click()
    })()`)
    await sleep(6000)

    check('进入观看页（有 video 元素）', await page.evaluate(`!!document.querySelector('video')`))

    check('点「分享」', await page.clickText('分享'))
    await sleep(700)
    check('分享面板出现', await page.evaluate(`/复制链接|二维码|嵌入代码/.test(document.body.innerText)`))
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(400)

    check('点「弹幕列表」', await page.clickText('弹幕列表'))
    await sleep(800)
    check('弹幕列表展开到多行', (await page.evaluate(`document.querySelectorAll('[class*="max-h-"] li').length`)) > 3)

    check('点「弹幕设置」', await page.clickText('弹幕设置'))
    await sleep(600)
    check('弹幕设置面板出现', await page.evaluate(`/显示区域|不透明度/.test(document.body.innerText)`))
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(400)

    // 评论是异步取的，等它先出几条再切筛选。
    let before = 0
    for (let i = 0; i < 20 && before === 0; i += 1) {
      await sleep(400)
      before = await page.evaluate(`document.querySelectorAll('[data-comment-id]').length`)
    }
    check('评论列表渲染出多条', before > 0)
    check('点「UP主」筛选', await page.clickExactText('UP主'))
    await sleep(1200)
    const filtered = await page.evaluate(`({
      count: document.querySelectorAll('[data-comment-id]').length,
      pressed: (() => {
        const hit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'UP主')
        return hit ? hit.getAttribute('aria-pressed') : null
      })(),
    })`)
    check('筛选已生效且不会变多', filtered.pressed === 'true' && filtered.count <= before)
  } finally {
    page.close()
  }

  if (checks.some((c) => !c.ok)) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
