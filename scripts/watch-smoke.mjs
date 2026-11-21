// 观看页面板冒烟：用无头 Chrome 打开 dev 服务器上的页面，挨个点开
// 分享 / 弹幕列表 / 弹幕设置，确认面板真的出来了。
//
// 用法：先 `npm run web`（1420），再 `node scripts/watch-smoke.mjs`。
// 它不依赖真机窗口，锁屏时也能跑；视觉与真机验收仍然要在 app 里做。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WEB = process.env.SMOKE_WEB || 'http://127.0.0.1:1420/'
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

  /** 真实空格：keydown 会经过全局快捷键，keyup 才触发按钮的原生 click。 */
  const pressSpace = async () => {
    await send(
      'Input.dispatchKeyEvent',
      {
        type: 'keyDown',
        key: ' ',
        code: 'Space',
        text: ' ',
        unmodifiedText: ' ',
        windowsVirtualKeyCode: 32,
        nativeVirtualKeyCode: 32,
      },
      sid,
    )
    await send(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
      sid,
    )
  }

  return {
    evaluate,
    viewport,
    doubleClick,
    pressSpace,
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

    // 焦点离开菜单和触发器时也要收起，不能两张卡的菜单同时挂着。
    await page.evaluate(`document.querySelectorAll('[data-track-card] button[aria-label="更多"]')[0]?.focus()`)
    await page.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
    await sleep(200)
    await page.evaluate(`document.querySelectorAll('[data-track-card] button[aria-label="更多"]')[1]?.focus()`)
    await sleep(200)
    const afterBlur = await page.evaluate(`document.querySelectorAll('[data-track-card] [role="menu"]').length`)
    await page.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
    await sleep(200)
    const afterSecond = await page.evaluate(`(() => {
      const menus = [...document.querySelectorAll('[data-track-card] [role="menu"]')]
      return {
        count: menus.length,
        second: menus[0]?.closest('[data-track-card]') === document.querySelectorAll('[data-track-card]')[1],
      }
    })()`)
    check('焦点移到第二张卡后第一张菜单收起', afterBlur === 0)
    check('第二张卡只开一个菜单', afterSecond.count === 1 && afterSecond.second)
    await page.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(200)
    check(
      '第二张卡 Esc 关闭并回到触发按钮',
      (await page.evaluate(`document.querySelectorAll('[data-track-card] [role="menu"]').length`)) === 0 &&
        (await page.evaluate(`document.activeElement?.getAttribute('aria-label')`)) === '更多',
    )

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
      setter?.call(input, '周杰伦')
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
      searched = await page.evaluate(`document.body.innerText.includes('综合') && document.querySelectorAll('[data-track-card]').length > 0`)
    }
    check('顶栏搜索提交后出结果', submitted && searched)

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

    // 快捷键：空格要留给聚焦的按钮，Ctrl+K 不能穿过模态去聚焦背景搜索框。
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    await sleep(5000)
    const playLabel = () =>
      page.evaluate(
        `document.querySelector('button[aria-label="播放"],button[aria-label="暂停"]')?.getAttribute('aria-label') ?? null`,
      )
    const listenStarted = await page.evaluate(`(() => {
      const hit = document.querySelector('button[aria-label^="听 "]')
      if (!hit) return false
      hit.click()
      return true
    })()`)
    let playBefore = null
    for (let i = 0; i < 20 && !playBefore; i += 1) {
      await sleep(300)
      playBefore = await playLabel()
    }
    check('点「听」后播放条出现', listenStarted && playBefore !== null)

    const loginFocused = await page.evaluate(`(() => {
      const hit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '登录')
      if (!hit) return false
      hit.focus()
      return document.activeElement === hit
    })()`)
    await page.pressSpace()
    await sleep(600)
    check(
      '聚焦按钮时空格走原生激活（登录弹窗打开）',
      loginFocused &&
        (await page.evaluate(
          `[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((el) => el.getClientRects().length > 0)`,
        )),
    )
    check('聚焦按钮时空格不触发播放/暂停', (await playLabel()) === playBefore)

    const modalKey = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
        .find((el) => el.getClientRects().length > 0)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
      return {
        inDialog: !!dialog && dialog.contains(document.activeElement),
        onSearch: document.activeElement?.getAttribute('aria-label') === '顶栏搜索',
      }
    })()`)
    check('模态打开时 Ctrl+K 不把焦点移到背景搜索框', modalKey.inDialog && !modalKey.onSearch)

    await page.evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
    )
    await sleep(500)
    check(
      'Esc 关闭登录弹窗',
      !(await page.evaluate(
        `[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((el) => el.getClientRects().length > 0)`,
      )),
    )

    await page.evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`,
    )
    await sleep(300)
    check(
      '关闭弹窗后 Ctrl+K 恢复聚焦顶栏搜索',
      await page.evaluate(`document.activeElement?.getAttribute('aria-label') === '顶栏搜索'`),
    )

    const blankFocused = await page.evaluate(`(() => {
      document.activeElement?.blur()
      const main = document.getElementById('main-content')
      if (!main) return false
      main.focus()
      return document.activeElement === main
    })()`)
    const beforeBlank = await playLabel()
    await page.pressSpace()
    await sleep(400)
    check('焦点在页面空白时空格控制播放', blankFocused && (await playLabel()) !== beforeBlank)

  } finally {
    page.close()
  }

  if (checks.some((c) => !c.ok)) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
