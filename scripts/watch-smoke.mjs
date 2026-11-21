// 观看页面板冒烟：用无头 Chrome 打开 dev 服务器上的页面，挨个点开
// 分享 / 弹幕列表 / 弹幕设置，确认面板真的出来了。
//
// 用法：先 `npm run web`（1420），再 `node scripts/watch-smoke.mjs`。
// 它不依赖真机窗口，锁屏时也能跑；视觉与真机验收仍然要在 app 里做。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WEB = 'http://127.0.0.1:1420/'
const PORT = 9224
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32'
  ? join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe')
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

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
      `--user-data-dir=${join(tmpdir(), 'oh-bilibili-smoke')}`,
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

  const viewport = (width, height) =>
    send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      sid,
    )
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

  /** 真实双击：两下 press/release，第二下 clickCount=2，才会触发 dblclick。 */
  const doubleClick = async (x, y) => {
    for (const clickCount of [1, 2]) {
      await send(
        'Input.dispatchMouseEvent',
        { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount },
        sid,
      )
      await send(
        'Input.dispatchMouseEvent',
        { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount },
        sid,
      )
    }
  }

  return {
    evaluate,
    viewport,
    doubleClick,
    mouseEvent: (params) => send('Input.dispatchMouseEvent', params, sid),
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

async function controlFit(page) {
  return page.evaluate(`(() => {
    const frame = document.querySelector('[data-watch-player]')
    const row = document.querySelector('[data-watch-controls]')
    const rail = document.querySelector('[data-watch-rail]')
    const visible = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return false
      const style = getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().width > 0
    }
    if (!frame || !row) return null
    const frameBox = frame.getBoundingClientRect()
    const buttons = [...row.querySelectorAll('button')].filter((b) => {
      const style = getComputedStyle(b)
      return style.display !== 'none' && style.visibility !== 'hidden' && b.getBoundingClientRect().width > 0
    })
    const outside = buttons.filter((b) => {
      const box = b.getBoundingClientRect()
      return box.right > frameBox.right + 0.5 || box.left < frameBox.left - 0.5
    })
    return {
      overflow: row.scrollWidth - row.clientWidth,
      outside: outside.length,
      rail: !!rail && getComputedStyle(rail).display !== 'none',
      inline: visible('[data-watch-inline]'),
      shot: visible('button[aria-label="截图"]'),
      pip: visible('button[aria-label="画中画"]'),
      volume: visible('button[aria-label="静音"], button[aria-label="取消静音"]'),
      web: visible('button[aria-label="网页全屏"], button[aria-label="退出网页全屏"]'),
      full: visible('button[aria-label="全屏"], button[aria-label="退出全屏"]'),
    }
  })()`)
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

    // 首页卡片：hover 只露出听、稍后再看和更多；低频动作收进更多。
    await page.evaluate(`document.querySelector('[data-track-card]')?.scrollIntoView({ block: 'center' })`)
    await sleep(500)
    const cardBox = await page.evaluate(`(() => {
      const card = document.querySelector('[data-track-card]')
      const more = card?.querySelector('button[aria-label="更多"]')?.getBoundingClientRect()
      const box = card?.getBoundingClientRect()
      if (!box || !more) return null
      return {
        x: box.left + box.width / 2,
        y: box.top + 12,
        moreX: more.left + more.width / 2,
        moreY: more.top + more.height / 2,
        later: card.querySelectorAll('button[aria-label="稍后再看"]').length,
      }
    })()`)
    await page.mouseEvent({ type: 'mouseMoved', x: cardBox.x, y: cardBox.y })
    await sleep(350)
    const hoveredCard = await page.evaluate(`(() => {
      const row = document.querySelector('[data-track-card] [data-card-actions]')
      if (!row) return null
      return {
        opacity: getComputedStyle(row).opacity,
        labels: [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim()),
      }
    })()`)
    check(
      '卡片 hover 露出听、稍后再看和更多',
      hoveredCard?.opacity === '1' &&
        hoveredCard.labels.some((label) => label.startsWith('听 ')) &&
        hoveredCard.labels.includes('稍后再看') &&
        hoveredCard.labels.includes('更多'),
    )
    check('每张卡只有一个稍后再看', cardBox.later === 1 && hoveredCard?.labels.length === 3)
    const clickAt = async (x, y) => {
      await page.mouseEvent({ type: 'mouseMoved', x, y })
      await page.mouseEvent({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await page.mouseEvent({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      await sleep(300)
    }
    await clickAt(cardBox.moreX, cardBox.moreY)
    const menuItems = await page.evaluate(`(() => {
      const menu = document.querySelector('[data-track-card] [role="menu"]')
      return menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim()) : null
    })()`)
    check(
      '鼠标能打开更多，四项低频动作都在',
      menuItems?.length === 4 &&
        menuItems.includes('点赞') &&
        menuItems.includes('投币') &&
        menuItems.includes('收藏') &&
        menuItems.includes('下载'),
    )
    await clickAt(cardBox.moreX, cardBox.moreY)
    check('再点更多收起菜单', !(await page.evaluate(`!!document.querySelector('[data-track-card] [role="menu"]')`)))
    const focusedMore = await page.evaluate(`(() => {
      const button = document.querySelector('[data-track-card] button[aria-label="更多"]')
      button?.focus()
      return document.activeElement?.getAttribute('aria-label')
    })()`)
    check('键盘能聚焦更多', focusedMore === '更多')
    await page.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
    await sleep(300)
    check('键盘 Enter 打开更多', await page.evaluate(`!!document.querySelector('[data-track-card] [role="menu"]')`))
    await page.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)
    const keyboardClosed = await page.evaluate(`(() => ({
      menu: !!document.querySelector('[data-track-card] [role="menu"]'),
      focused: document.activeElement?.getAttribute('aria-label'),
    }))()`)
    check('Esc 关闭更多并把焦点还给触发按钮', !keyboardClosed.menu && keyboardClosed.focused === '更多')

    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '').startsWith('观看'))
      if (card) card.click()
    })()`)
    // 页面是异步取数再挂播放器，固定 sleep 会抖：轮询到 video 出现为止。
    let hasVideo = false
    for (let i = 0; i < 30 && !hasVideo; i += 1) {
      await sleep(500)
      hasVideo = await page.evaluate(`!!document.querySelector('video')`)
    }

    check('进入观看页（有 video 元素）', hasVideo)

    check('点「分享」', await page.clickText('分享'))
    await sleep(700)
    check('分享面板出现', await page.evaluate(`/复制链接|二维码|嵌入代码/.test(document.body.innerText)`))
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(400)

    check('点「弹幕列表」', await page.clickText('弹幕列表'))
    await sleep(800)
    check('弹幕列表展开到多行', (await page.evaluate(`document.querySelectorAll('[class*="max-h-"] li').length`)) > 3)

    const layout = await page.evaluate(`(() => {
      const doc = document.scrollingElement
      const video = document.querySelector('video')
      const box = video ? video.getBoundingClientRect() : null
      return {
        overflow: doc ? doc.scrollWidth - doc.clientWidth : -1,
        ratio: box && box.height > 0 ? box.width / box.height : 0,
      }
    })()`)
    check('1320 宽没有横向溢出', layout.overflow === 0)
    check('画面保持 16:9', Math.abs(layout.ratio - 16 / 9) < 0.05)

    // 无头预览取不到流，时间始终是 0，所以看播放器探针记录的落点，
    // 而不是看画面上的进度。
    const slider = await page.evaluate(`(() => {
      const el = document.querySelector('[role="slider"][aria-label="播放进度"]')
      if (!el) return null
      const box = el.getBoundingClientRect()
      return { left: box.left, y: box.top + box.height / 2, width: box.width }
    })()`)
    check('控制条上有进度条', !!slider)
    if (slider) {
      const at = (ratio) => slider.left + slider.width * ratio
      await page.mouseEvent({ type: 'mouseMoved', x: at(0.2), y: slider.y })
      await page.mouseEvent({
        type: 'mousePressed',
        x: at(0.2),
        y: slider.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      })
      await page.mouseEvent({ type: 'mouseMoved', x: at(0.7), y: slider.y, buttons: 1 })
      await sleep(150)
      const during = await page.evaluate(`window.__ohBilibiliWatch?.state() ?? null`)
      check('拖动时进度跟手但不落位', !!during && Math.abs((during.scrub ?? -1) - 0.7) < 0.02)
      await page.mouseEvent({
        type: 'mouseReleased',
        x: at(0.7),
        y: slider.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      })
      await sleep(150)
      const after = await page.evaluate(`window.__ohBilibiliWatch?.state() ?? null`)
      const want = during ? during.duration * 0.7 : 0
      check(
        '松手后落到松手位置',
        !!after &&
          after.scrub === null &&
          after.lastSeek !== null &&
          Math.abs(after.lastSeek - want) <= Math.max(500, want * 0.02),
      )

      const seekBefore = await page.evaluate(`window.__ohBilibiliWatch?.state()?.lastSeek ?? null`)
      await page.evaluate(`(() => {
        const el = document.querySelector('[role="slider"][aria-label="播放进度"]')
        if (!el) return false
        for (const type of ['pointerdown', 'pointerup']) {
          el.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: 0,
            clientY: 0,
            button: 0,
            pointerId: 1,
          }))
        }
        return true
      })()`)
      await sleep(150)
      const seekAfter = await page.evaluate(`window.__ohBilibiliWatch?.state()?.lastSeek ?? null`)
      check('没有坐标的 press 不会把进度打回开头', seekBefore !== null && seekAfter === seekBefore)

      const keyBefore = await page.evaluate(`window.__ohBilibiliWatch?.state()?.lastSeek ?? null`)
      const keySent = await page.evaluate(`(() => {
        const el = document.querySelector('[role="slider"][aria-label="播放进度"]')
        if (!el) return false
        el.focus()
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
        return true
      })()`)
      await sleep(150)
      const keyAfter = await page.evaluate(`window.__ohBilibiliWatch?.state()?.lastSeek ?? null`)
      check(
        '进度条键盘 End 能落位',
        keySent && keyBefore !== null && keyAfter !== null && keyAfter !== keyBefore && keyAfter > 0,
      )

      const pipAt1320 = await page.evaluate(`(() => {
        const enabled = !!document.pictureInPictureEnabled
        const btn = document.querySelector('button[aria-label="画中画"]')
        return { enabled, visible: btn ? getComputedStyle(btn).display !== 'none' : false }
      })()`)
      check('支持画中画时桌面控制条有入口', !pipAt1320.enabled || pipAt1320.visible)
    }

    const fit1320 = await controlFit(page)
    check('1320 宽右栏出现', !!fit1320?.rail)
    check('1320 宽正文不重复右栏内容', !!fit1320 && !fit1320.inline)
    check('1320 宽控制条没有被裁切', !!fit1320 && fit1320.overflow <= 1 && fit1320.outside === 0)
    check('1320 宽保留截图入口', !!fit1320?.shot)

    for (const width of [768, 980]) {
      await page.viewport(width, 860)
      await sleep(700)
      const fit = await controlFit(page)
      check(`${width} 宽控制条没有被裁切`, !!fit && fit.overflow <= 1 && fit.outside === 0)
      check(`${width} 宽不出双栏`, !!fit && !fit.rail)
      check(`${width} 宽右栏内容留在正文`, !!fit && fit.inline)
      check(`${width} 宽保留画中画、音量、网页全屏、全屏`, !!fit && fit.pip && fit.volume && fit.web && fit.full)
      check(`${width} 宽截图入口按空间收起`, !!fit && !fit.shot)

      const mute = await page.evaluate(`(() => {
        const btn = document.querySelector('button[aria-label="静音"], button[aria-label="取消静音"]')
        if (!btn) return null
        const box = btn.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      })()`)
      check(`${width} 宽有音量按钮`, !!mute)
      if (!mute) continue
      const volumeWidth = () => page.evaluate(`(() => {
        const slider = document.querySelector('[role="slider"][aria-label="音量"]')
        return slider?.parentElement?.getBoundingClientRect().width ?? 0
      })()`)
      const before = await volumeWidth()
      await page.mouseEvent({ type: 'mouseMoved', x: mute.x, y: mute.y })
      await sleep(300)
      const after = await volumeWidth()
      const expanded = await controlFit(page)
      check(`${width} 宽音量滑杆真的展开`, after > before + 40)
      check(`${width} 宽音量展开后控制条仍完整`, !!expanded && expanded.overflow <= 1 && expanded.outside === 0)
      await page.mouseEvent({ type: 'mouseMoved', x: 1, y: 1 })
    }

    await page.viewport(700, 860)
    await sleep(600)
    check('700 宽没有横向溢出', (await page.evaluate(`document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth`)) === 0)
    const speedAt700 = await page.evaluate(`(() => {
      const btn = document.querySelector('button[aria-label^="播放倍速"]')
      if (!btn) return null
      const box = btn.getBoundingClientRect()
      return { visible: box.width > 0 && getComputedStyle(btn).display !== 'none' }
    })()`)
    check('700 宽仍能改播放倍速', !!speedAt700?.visible)
    const fit700 = await controlFit(page)
    check('700 宽保留截图入口', !!fit700?.shot)
    if (speedAt700?.visible) {
      await page.evaluate(`document.querySelector('button[aria-label^="播放倍速"]')?.click()`)
      await sleep(200)
      check(
        '窄屏倍速菜单可打开',
        await page.evaluate(
          `[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '1.5x')`,
        ),
      )
      await page.evaluate(`document.querySelector('button[aria-label^="播放倍速"]')?.click()`)
    }
    const pipAt700 = await page.evaluate(`(() => {
      const enabled = !!document.pictureInPictureEnabled
      const btn = document.querySelector('button[aria-label="画中画"]')
      return { enabled, visible: btn ? getComputedStyle(btn).display !== 'none' : false }
    })()`)
    check('700 宽隐藏画中画入口', !pipAt700.enabled || !pipAt700.visible)
    check(
      '700 宽仍能看到章节',
      await page.evaluate(
        `[...document.querySelectorAll('h3')].some((el) => el.textContent.trim() === '章节' && el.getClientRects().length > 0)`,
      ),
    )
    await page.viewport(1320, 900)
    await sleep(400)

    // 网页全屏：W 进去要有明确的退出入口，画面不能被拉变形，弹幕输入还在。
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))`)
    await sleep(1200)
    const cinema = await page.evaluate(`(() => {
      const exit = [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('退出网页全屏'))
      const video = document.querySelector('video')
      const fit = video ? getComputedStyle(video).objectFit : ''
      return { exit, fit, composer: !!document.querySelector('input[placeholder*="弹幕"]') }
    })()`)
    check('网页全屏有退出入口', cinema.exit)
    check('网页全屏画面等比（contain）', cinema.fit === 'contain')
    check('网页全屏保留弹幕输入', cinema.composer)
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))`)
    await sleep(800)
    check('再按 W 退出网页全屏', !(await page.evaluate(`document.body.innerText.includes('退出网页全屏')`)))

    // 双击画面这条**不能**在这里测：web 预览拿不到真实清单，播放器上盖着
    // 一层取流失败的浮层，双击打不到 <video>。它只在真机 app 里成立
    // （已验证：双击进/出网页全屏，播放状态不受影响）。

    check('点「弹幕设置」', await page.clickText('弹幕设置'))
    await sleep(600)
    check('弹幕设置面板出现', await page.evaluate(`/显示区域|不透明度/.test(document.body.innerText)`))
    const redClicked = await page.evaluate(`(() => {
      const hit = document.querySelector('button[aria-label="弹幕颜色 红"]')
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(200)
    const redStored = await page.evaluate(`(() => {
      try { return JSON.parse(localStorage.getItem('bilimusic.danmaku') || '{}').sendColor } catch { return null }
    })()`)
    check('弹幕颜色写入偏好', redClicked && redStored === 16646914)
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(400)

    // 评论是异步取的，等它先出几条再切筛选。
    let before = 0
    for (let i = 0; i < 20 && before === 0; i += 1) {
      await sleep(400)
      before = await page.evaluate(`document.querySelectorAll('[data-comment-id]').length`)
    }
    check('评论列表渲染出多条', before > 0)
    check(
      '空格后的评论提及可点击',
      (await page.evaluate(
        `[...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === '@阿明').length`,
      )) === 2,
    )
    check(
      '评论图片缩略图放大到 88px',
      (await page.evaluate(
        `document.querySelector('button[aria-label^="查看第"] img')?.getBoundingClientRect().width ?? 0`,
      )) >= 88,
    )
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

    // 弹幕颜色偏好跨页面重载沿用。
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    await sleep(5000)
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '').startsWith('观看'))
      if (card) card.click()
    })()`)
    let hasVideoAgain = false
    for (let i = 0; i < 30 && !hasVideoAgain; i += 1) {
      await sleep(500)
      hasVideoAgain = await page.evaluate(`!!document.querySelector('video')`)
    }
    check('再次进入观看页', hasVideoAgain)
    check('点「弹幕设置」重开', await page.clickText('弹幕设置'))
    await sleep(600)
    check(
      '重载后弹幕颜色仍是红色',
      (await page.evaluate(
        `document.querySelector('button[aria-label="弹幕颜色 红"]')?.getAttribute('aria-pressed')`,
      )) === 'true',
    )
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(400)

    // 结束卡：?forceEnded=1 让播放器直接落到播完状态。
    await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?forceEnded=1`)}`)
    await sleep(5000)
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '').startsWith('观看'))
      if (card) card.click()
    })()`)
    let endCard = null
    for (let i = 0; i < 20 && !endCard; i += 1) {
      await sleep(400)
      endCard = await page.evaluate(`(() => {
        const label = [...document.querySelectorAll('span')].find((el) => el.textContent === '即将播放')
        if (!label) return null
        const card = label.parentElement?.parentElement?.querySelector('button')
        return {
          text: (card?.innerText || '').trim(),
          cover: !!card?.querySelector('img'),
          autoplay: !!document.querySelector('[role="switch"][aria-label="自动连播"]'),
        }
      })()`)
    }
    check('结束卡给出即将播放的下一集', !!endCard && endCard.cover && endCard.text.length > 0)
    check('结束卡保留自动连播开关', !!endCard?.autoplay)

    // 搜索入口只在顶栏：点开有联想 panel，提交后进结果页；侧栏不再有独立搜索页。
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    await sleep(5000)
    check(
      '侧边栏不再有独立搜索入口',
      !(await page.evaluate(
        `[...document.querySelectorAll('nav[aria-label="主导航"] button')].some((b) => (b.textContent || '').trim() === '搜索')`,
      )),
    )
    await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      if (!input) return false
      input.focus()
      return true
    })()`)
    await sleep(400)
    check('点顶栏搜索框出现联想面板', await page.evaluate(`!!document.querySelector('[data-search-suggest-panel]')`))
    await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '晴天')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(300)
    const submitted = await page.evaluate(`(() => {
      const form = document.querySelector('input[aria-label="顶栏搜索"]')?.closest('form')
      if (!form) return false
      form.requestSubmit()
      return true
    })()`)
    let searched = false
    for (let i = 0; i < 20 && !searched; i += 1) {
      await sleep(400)
      searched = await page.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="搜索结果"]')
        return !!dialog && dialog.querySelectorAll('[data-track-card]').length > 0
      })()`)
    }
    check('顶栏搜索提交后出结果', submitted && searched)
    await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="搜索结果"]')
      dialog?.querySelector('button[aria-label^="观看"]')?.click()
    })()`)
    let searchVideo = false
    for (let i = 0; i < 30 && !searchVideo; i += 1) {
      await sleep(500)
      searchVideo = await page.evaluate(`!!document.querySelector('video')`)
    }
    await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
    await sleep(900)
    const returned = await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="搜索结果"]')
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      const active = document.activeElement
      return {
        dialog: !!dialog,
        query: input ? input.value : '',
        focused: !!active?.closest?.('[data-track-card]'),
      }
    })()`)
    check('从搜索结果返回会重新展开结果', searchVideo && returned.dialog && returned.query === '晴天')
    check('返回后焦点落回结果卡片', returned.focused)

    // 多 P 预览：分享链接和嵌入代码必须指向当前 P。
    await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?multiP=1`)}`)
    await sleep(5000)
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '').startsWith('观看'))
      if (card) card.click()
    })()`)
    let multiVideo = false
    for (let i = 0; i < 30 && !multiVideo; i += 1) {
      await sleep(500)
      multiVideo = await page.evaluate(`!!document.querySelector('video')`)
    }
    const switchedP2 = await page.evaluate(`(() => {
      const picker = document.querySelector('button[aria-label="选集"]')
      if (!picker) return false
      picker.click()
      const p2 = [...document.querySelectorAll('button')].find((b) =>
        (b.textContent || '').includes('第二 P · 预览'))
      if (!p2) return false
      p2.click()
      return true
    })()`)
    await sleep(1600)
    check('多 P 预览切到 P2', multiVideo && switchedP2)
    await page.clickText('分享')
    await sleep(700)
    const withTimeToggled = await page.evaluate(`(() => {
      const input = [...document.querySelectorAll('input[type="checkbox"]')].find((el) =>
        (el.closest('label')?.textContent || '').includes('开始分享'))
      if (!input) return false
      input.click()
      return true
    })()`)
    await sleep(150)
    check('点「嵌入代码」', await page.clickExactText('嵌入代码'))
    await sleep(200)
    const embedParams = await page.evaluate(`(() => {
      const value = document.querySelector('textarea[readonly]')?.value ?? ''
      const src = value.split('src="')[1]?.split('"')[0] ?? ''
      const url = new URL(src.startsWith('//') ? 'https:' + src : src)
      return { p: url.searchParams.get('p'), t: url.searchParams.get('t') }
    })()`)
    check(
      '分享当前分 P 带 p=2 和时间',
      withTimeToggled && embedParams?.p === '2' && embedParams?.t !== null,
    )
    check(
      '短选集不出现找分集',
      !(await page.evaluate(`!!document.querySelector('input[aria-label="找分集"]')`)),
    )

    // 长分 P 预览：找分集只筛选列表，选中才切 P，清空后完整列表和当前项都回来。
    await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?manyPages=1`)}`)
    await sleep(5000)
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '').startsWith('观看'))
      if (card) card.click()
    })()`)
    let manyVideo = false
    for (let i = 0; i < 30 && !manyVideo; i += 1) {
      await sleep(500)
      manyVideo = await page.evaluate(`!!document.querySelector('video')`)
    }
    const visiblePanel = `[...document.querySelectorAll('[data-watch-pages]')].find((el) => el.getClientRects().length > 0)`
    const pageRows = `(() => {
      const panel = ${visiblePanel}
      const list = panel?.querySelector('ol')
      const rows = list ? [...list.querySelectorAll('li')] : []
      return {
        count: rows.length,
        text: rows.map((row) => row.textContent?.trim() ?? '').join('|'),
        active: rows.find((row) => row.querySelector('button[aria-pressed="true"]'))?.textContent?.trim() ?? '',
        header: panel?.querySelector('h3')?.parentElement?.textContent?.trim() ?? '',
      }
    })()`
    const typeIntoFilter = (value) => page.evaluate(`(() => {
      const input = ${visiblePanel}?.querySelector('input[aria-label="找分集"]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    const beforeFilter = await page.evaluate(pageRows)
    check('长分 P 选集出现找分集', manyVideo && beforeFilter.count === 80)
    check('找分集输入框可用', await typeIntoFilter('P62'))
    await sleep(300)
    const byNumber = await page.evaluate(pageRows)
    check(
      '输入 P62 只筛选不切换',
      byNumber.count === 1 &&
        byNumber.text.includes('P62') &&
        byNumber.header === beforeFilter.header,
    )
    await typeIntoFilter('现场')
    await sleep(300)
    const byTitle = await page.evaluate(pageRows)
    check('输入标题片段只留下匹配集', byTitle.count === 1 && byTitle.text.includes('晴天 · 现场版'))
    await typeIntoFilter('P62')
    await sleep(200)
    await page.evaluate(`${visiblePanel}?.querySelector('ol li button')?.click()`)
    await sleep(1500)
    const picked = await page.evaluate(pageRows)
    check('选中筛选结果才切到 P62', picked.header.includes('(62/80)'))
    await page.evaluate(`${visiblePanel}?.querySelector('button[aria-label="清除筛选"]')?.click()`)
    await sleep(300)
    const cleared = await page.evaluate(pageRows)
    check(
      '清除筛选恢复 80 集并保留当前项标记',
      cleared.count === 80 && cleared.active.includes('P62'),
    )

    // 历史：翻到第 61 条，并把不同年份的同月同日分成两组。
    await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?historyLong=1`)}`)
    await sleep(5000)
    const openedHistory = await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '历史') : null
      if (!hit) return false
      hit.click()
      return true
    })()`)
    let historyReady = false
    for (let i = 0; i < 20 && !historyReady; i += 1) {
      await sleep(400)
      historyReady = await page.evaluate(`document.querySelectorAll('[data-track-card]').length > 0`)
    }
    const firstPage = await page.evaluate(`(() => ({
      cards: document.querySelectorAll('[data-track-card]').length,
      loadMore: !![...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '加载更早记录'),
    }))()`)
    check(
      '历史首屏 60 条并给出加载更早',
      openedHistory && historyReady && firstPage.cards === 60 && firstPage.loadMore,
    )
    await page.clickExactText('加载更早记录')
    let loadedAll = false
    for (let i = 0; i < 20 && !loadedAll; i += 1) {
      await sleep(300)
      loadedAll = await page.evaluate(`document.querySelectorAll('[data-track-card]').length === 100`)
    }
    const afterLoad = await page.evaluate(`(() => {
      const text = document.body.innerText
      const heads = [...document.querySelectorAll('h2')].map((h) => (h.textContent || '').trim())
      return {
        has61: text.includes('历史记录 61'),
        groups: heads.filter((h) => h.includes('4 月 10 日')),
        more: !![...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '加载更早记录'),
      }
    })()`)
    check('加载更早记录能找回第 61 条', loadedAll && afterLoad.has61)
    check(
      '同月同日不同年份分成两组',
      afterLoad.groups.length === 2 &&
        afterLoad.groups.some((g) => g.startsWith('2025')) &&
        afterLoad.groups.some((g) => g.startsWith('2024')),
    )
    check('取完 100 条后按钮收起', !afterLoad.more)

    // 播放队列：清空仍是一次点击，随后给出带数量的撤销。
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    await sleep(5000)
    const startedListen = await page.evaluate(`(() => {
      const hit = [...document.querySelectorAll('button')].find((b) =>
        (b.getAttribute('aria-label') || '') === '听 红豆')
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(2500)
    const openedQueue = await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const tab = rail
        ? [...rail.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith('队列'))
        : null
      if (!tab) return false
      tab.click()
      return true
    })()`)
    await sleep(500)
    const queueBefore = await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const text = rail?.textContent || ''
      const match = /接下来 · (\\d+) 首/.exec(text)
      const rows = rail ? rail.querySelectorAll('[role="button"][title="拖动可以调整顺序"]') : []
      return { count: match ? Number(match[1]) : 0, rows: rows.length }
    })()`)
    check('播放页队列有曲目', startedListen && openedQueue && queueBefore.count > 0 && queueBefore.rows === queueBefore.count)
    await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const clear = [...(rail?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim() === '清空')
      clear?.click()
    })()`)
    await sleep(500)
    const afterClear = await page.evaluate(`(() => {
      const strip = document.querySelector('[data-queue-undo]')
      const rail = document.querySelector('[aria-label="播放右栏"]')
      return {
        strip: strip?.textContent?.trim() ?? '',
        rows: rail ? rail.querySelectorAll('[role="button"][title="拖动可以调整顺序"]').length : -1,
      }
    })()`)
    check(
      '清空后显示数量和撤销',
      afterClear.rows === 0 && afterClear.strip.includes(`已清空 ${queueBefore.count} 首`) && afterClear.strip.includes('撤销'),
    )
    await page.evaluate(`document.querySelector('[data-queue-undo] button')?.click()`)
    await sleep(800)
    const afterUndo = await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const rows = rail ? [...rail.querySelectorAll('[role="button"][title="拖动可以调整顺序"]')] : []
      return {
        rows: rows.length,
        active: rows.some((row) => row.getAttribute('aria-current') === 'true'),
        strip: !!document.querySelector('[data-queue-undo]'),
      }
    })()`)
    check(
      '撤销恢复曲目和当前项',
      afterUndo.rows === queueBefore.count && afterUndo.active && !afterUndo.strip,
    )

  } finally {
    page.close()
  }

  if (checks.some((c) => !c.ok)) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
