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
const DYNAMIC_RETURN = process.argv.includes('--dynamic-return')
const libraryPartialOnly = process.argv.includes('--library-partial')
const PORT = Number(process.env.SMOKE_CDP_PORT || (DYNAMIC_RETURN ? 9324 : 9224))
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
      ...(DYNAMIC_RETURN || libraryPartialOnly
        ? ['--disable-background-networking', '--proxy-server=http://127.0.0.1:1']
        : []),
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${join(tmpdir(), `oh-bilibili-smoke-${PORT}`)}`,
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
  const errors = []
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method === 'Runtime.exceptionThrown') {
      const detail = msg.params.exceptionDetails
      errors.push(detail.exception?.description ?? detail.text)
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((arg) => arg.description ?? arg.value).join(' '))
    }
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
    errors,
    runtimeErrors: errors,
    viewport,
    doubleClick,
    pressSpace,
    mouseEvent: (params) => send('Input.dispatchMouseEvent', params, sid),
    keyEvent: (params) => send('Input.dispatchKeyEvent', params, sid),
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

async function checkListErrors(page) {
  const lists = [
    { label: '稍后再看', title: '稍后再看没取到', entry: '晴天' },
    { label: '关注', title: '关注列表没取到', entry: '造梦阿瑄' },
  ]
  const dialog = `!!document.querySelector('[role="dialog"][aria-label="扫码登录"]')`
  const waitFor = async (expression, timeout = 3000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(100)
    }
    return false
  }
  const startErrors = page.runtimeErrors.length
  for (const kind of ['retryable', 'needs_login', 'input']) {
    for (const { label, title, entry } of lists) {
      const url = new URL(WEB)
      url.searchParams.set('listError', kind)
      url.searchParams.set('list', label)
      await page.evaluate(`location.href = ${JSON.stringify(url.href)}`)
      await waitFor(`location.href === ${JSON.stringify(url.href)} && !!document.querySelector('nav[aria-label="主导航"]')`)
      const active = `(() => {
        const button = document.querySelector('nav[aria-label="主导航"] button[aria-current="page"]')
        return (button?.getAttribute('aria-label') || button?.textContent.trim()) === ${JSON.stringify(label)}
      })()`
      const error = `document.querySelector('main h2')?.textContent.trim() === ${JSON.stringify(title)}`
      const detail = (text) => `document.querySelector('main p')?.textContent.trim() === ${JSON.stringify(text)}`
      const buttons = `[...document.querySelectorAll('main button')].map((button) => button.textContent.trim()).join(',')`
      const recovered = `${active} && !(${error}) && !document.querySelector('[role="dialog"]') && document.querySelector('main #scroll-main')?.innerText.includes(${JSON.stringify(entry)})`
      const clicked = await page.clickExactText(label)
      const failed = clicked && await waitFor(`${active} && ${error}`)
      if (kind === 'retryable') {
        check(`${label}超时显示原地重试`, failed && await page.evaluate(
          `${detail('连不上 B 站，检查一下网络。')} && ${buttons} === '重试' && !(${dialog})`,
        ))
        const retried = await page.clickExactText('重试')
        check(`${label}重试后在原页显示列表`, retried && await waitFor(recovered))
      } else if (kind === 'needs_login') {
        const login = failed && await page.evaluate(`${buttons} === '去登录'`) && await page.clickExactText('去登录')
        const qrOpened = login && await waitFor(`${active} && ${dialog}`)
        check(`${label}需要登录时直接打开登录框`, qrOpened)
        const confirmed = qrOpened && await waitFor(
          `${active} && !!document.querySelector('[role="dialog"][aria-label="账号"]')`,
          10_000,
        )
        check(`${label}模拟扫码登录成功`, confirmed)
        check(`${label}登录后在原页显示列表`, confirmed && await waitFor(recovered))
      } else {
        await sleep(300)
        check(`${label}保留永久错误`, failed && await page.evaluate(
          `${active} && ${error} && ${detail('列表请求无效')} && ${buttons} === '' && !(${dialog})`,
        ))
      }
    }
  }
  const listErrors = page.runtimeErrors.slice(startErrors)
  check('列表失败和重试没有控制台错误或未处理的拒绝', listErrors.length === 0)
  for (const error of listErrors) console.log(error)
}

async function checkLibraryPartial(page) {
  const url = new URL(WEB)
  url.searchParams.set('libraryPartial', '1')
  await page.evaluate(`location.href = ${JSON.stringify(url)}`)
  let opened = false
  for (let i = 0; i < 40 && !opened; i += 1) {
    await sleep(250)
    opened = await page.clickText('曲库')
  }
  check('打开曲库', opened)
  await sleep(600)

  const card = (name) => `document.querySelector('#scroll-main button [title="${name}"]')?.closest('button')`
  const labels = await page.evaluate(`[
    ${card('深夜循环')},
    ${card('翻唱现场')},
    ${card('纯音乐与白噪音')},
  ].map((button) => button?.innerText.split('\\n').at(-1))`)
  check(`有歌的歌单显示 5 首（实际：${labels[0]}）`, labels[0] === '5 首')
  check(`失败的歌单提示曲目数未取到（实际：${labels[1]}）`, labels[1] === '曲目数未取到')
  check(`真正空的歌单显示空歌单（实际：${labels[2]}）`, labels[2] === '空歌单')

  const retried = await page.evaluate(`(() => {
    performance.clearMarks('library_tracks')
    const retry = [...(${card('翻唱现场')}?.parentElement.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent.trim() === '重试')
    retry?.click()
    return !!retry
  })()`)
  await sleep(600)
  const reads = await page.evaluate(`performance.getEntriesByName('library_tracks').map((entry) => entry.detail)`)
  check(`重试只读取翻唱现场一次（实际：${JSON.stringify(reads)}）`, retried && reads.length === 1 && reads[0] === 2)
  const recovered = await page.evaluate(`${card('翻唱现场')}?.innerText.split('\\n').at(-1)`)
  check('重试成功后显示 4 首', recovered === '4 首')

  await page.evaluate(`${card('深夜循环')}?.click()`)
  await sleep(600)
  const tracks = await page.evaluate(`[...document.querySelectorAll('#scroll-main [data-row="track"]')].map((row) => row.innerText)`)
  check('打开深夜循环后显示 5 首歌', tracks.length === 5 && tracks[0].includes('晴天'))
  check(`曲库没有控制台错误或未处理异常（${page.errors.length} 条）`, page.errors.length === 0)
}

async function checkHeroAllocation(page) {
  const url = new URL(WEB)
  url.searchParams.set('heroAllocation', '1')
  await page.viewport(1024, 900)
  await page.evaluate(`location.href = ${JSON.stringify(url.href)}`)
  let ready = false
  for (let i = 0; i < 40 && !ready; i += 1) {
    await sleep(250)
    ready = await page.evaluate(
      `document.querySelectorAll('[data-home-hero-grid] > button').length === 6 &&
       document.querySelectorAll('[data-home-feed] [data-track-card]').length >= 5`,
    )
  }
  const read = () =>
    page.evaluate(`(() => {
      const carousel = [...document.querySelectorAll('[aria-label="推荐轮播"] img[data-track-title]')]
        .map((image) => image.dataset.trackTitle ?? '')
      const grid = [...document.querySelectorAll('[data-home-hero-grid] > button')]
        .map((card) => card.querySelector('.line-clamp-2')?.textContent?.trim() ?? '')
      const feed = [...document.querySelectorAll('[data-home-feed] [data-track-card]')]
        .map((card) => card.dataset.trackTitle ?? '')
      return { carousel, grid, feed }
    })()`)
  const wide = await read()
  await page.viewport(1023, 900)
  await sleep(500)
  const narrow = await page.evaluate(`(() => ({
    carousel: [...document.querySelectorAll('[aria-label="推荐轮播"] img[data-track-title]')]
      .map((image) => image.dataset.trackTitle ?? ''),
    grid: document.querySelector('[data-home-hero-grid]') !== null,
    feed: [...document.querySelectorAll('[data-home-feed] [data-track-card]')].map((card) => card.dataset.trackTitle ?? ''),
  }))()`)
  await page.viewport(1024, 900)
  await sleep(500)
  const restored = await read()
  const initialTitles = Array.from({ length: 16 }, (_, index) => `首页分配 ${index + 1}`)
  const placedOnce = (expected, titles) =>
    expected.every((title) => titles.filter((entry) => entry === title).length === 1) &&
    new Set(titles).size === titles.length
  check(
    '首屏推荐在 1024 与 1023 两侧各有一次入口',
    ready &&
      wide.carousel.length === 5 &&
      wide.grid.length === 6 &&
      placedOnce(initialTitles, [...wide.carousel, ...wide.grid, ...wide.feed]) &&
      placedOnce(initialTitles, [...narrow.carousel, ...narrow.feed]) &&
      !narrow.grid &&
      restored.grid.length === 6 &&
      placedOnce(initialTitles, [...restored.carousel, ...restored.grid, ...restored.feed]),
  )
  const refreshedButton = await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '换一换')
    hit?.click()
    return !!hit
  })()`)
  let refreshedReady = false
  for (let i = 0; i < 20 && !refreshedReady; i += 1) {
    await sleep(200)
    refreshedReady = await page.evaluate(
      `[...document.querySelectorAll('[data-home-hero-grid] > button')].some((card) =>
        card.textContent.includes('首页分配 12'))`,
    )
  }
  const refreshed = await read()
  await page.viewport(1023, 900)
  await sleep(500)
  const refreshedNarrow = await page.evaluate(`(() => ({
    carousel: [...document.querySelectorAll('[aria-label="推荐轮播"] img[data-track-title]')]
      .map((image) => image.dataset.trackTitle ?? ''),
    grid: document.querySelector('[data-home-hero-grid]') !== null,
    feed: [...document.querySelectorAll('[data-home-feed] [data-track-card]')].map((card) => card.dataset.trackTitle ?? ''),
  }))()`)
  const refreshedTitles = [
    ...Array.from({ length: 6 }, (_, index) => `换一换 ${index + 1}`),
    ...Array.from({ length: 11 }, (_, index) => `首页分配 ${index + 6}`),
  ]
  const refreshedOnce = (titles) => placedOnce(refreshedTitles, titles)
  check(
    '换一换后首屏和推荐流仍不重复、不丢项',
    refreshedButton &&
      refreshedReady &&
      refreshed.grid.length === 6 &&
      refreshedOnce([...refreshed.carousel, ...refreshed.grid, ...refreshed.feed]) &&
      !refreshedNarrow.grid &&
      refreshedOnce([...refreshedNarrow.carousel, ...refreshedNarrow.feed]),
  )
  if (
    !refreshedOnce([...refreshed.carousel, ...refreshed.grid, ...refreshed.feed]) ||
    !refreshedOnce([...refreshedNarrow.carousel, ...refreshedNarrow.feed])
  ) {
    console.log(JSON.stringify({ refreshed, refreshedNarrow, refreshedTitles }))
  }
  await page.viewport(1320, 900)
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
      if (b.parentElement !== row && b.parentElement?.parentElement !== row) return false
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

async function dynamicReturn(page) {
  const title = '起风了｜深夜卧室版'
  const cardSelector = (name) => `[...document.querySelectorAll('article [role="button"]')].find(
    (button) => button.textContent.includes(${JSON.stringify(name)}),
  )`
  const readCard = (name = title) => page.evaluate(`(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const scroller = document.querySelector('#scroll-main')
    const card = ${cardSelector(name)}
    if (!scroller || !card) return null
    const rect = card.getBoundingClientRect()
    const viewport = scroller.getBoundingClientRect()
    const header = scroller.querySelector('header').getBoundingClientRect()
    const bodyToggle = [...card.closest('article').querySelectorAll('button')]
      .find((button) => button.textContent === '收起' || button.textContent === '展开')
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      top: rect.top - viewport.top,
      scroll: scroller.scrollTop,
      videoOnly: !scroller.innerText.includes('点歌台｜今晚只放你点的歌'),
      focused: document.activeElement === card,
      bodyToggle: bodyToggle?.textContent,
      visible: rect.top >= header.bottom && rect.bottom <= viewport.bottom,
    }
  })()`)
  const waitForCard = async (name) => {
    for (let i = 0; i < 30; i += 1) {
      const card = await readCard(name)
      if (card) return card
      await sleep(100)
    }
    return null
  }

  const openFeed = async (scenario) => {
    if (scenario) {
      const url = new URL(WEB)
      url.searchParams.set(scenario, '1')
      const href = JSON.stringify(url.href)
      await page.evaluate(`location.href = ${href}`)
      for (let i = 0; i < 30; i += 1) {
        if (await page.evaluate(`location.href === ${href}`)) break
        await sleep(100)
      }
    }
    for (let i = 0; i < 30; i += 1) {
      const opened = await page.evaluate(`(() => {
        const tab = [...document.querySelectorAll('[aria-label="主要导航"] button')]
          .find((button) => button.textContent.trim() === '动态')
        if (!tab) return false
        tab.click()
        return true
      })()`)
      if (opened) break
      await sleep(100)
    }
    if (!(await waitForCard()) || !(await page.clickExactText('视频投稿'))) {
      throw new Error('640×560 预览未载入视频投稿')
    }
    await page.evaluate("document.querySelector('#scroll-main').scrollTop = 483")
    return readCard()
  }
  const openWithEnter = async () => {
    await page.evaluate(`(${cardSelector(title)})?.focus({ preventScroll: true })`)
    const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
    await page.keyEvent({ type: 'keyDown', ...enter })
    await page.keyEvent({ type: 'keyUp', ...enter })
    return page.clickExactText('返回')
  }
  const toggleBody = (label) => page.evaluate(`(() => {
    const article = (${cardSelector(title)})?.closest('article')
    if (!article) return false
    const toggle = [...article.querySelectorAll('button')]
      .find((button) => button.textContent === ${JSON.stringify(label)})
    if (!toggle) return false
    toggle.click()
    return true
  })()`)

  const firstError = page.runtimeErrors.length
  await page.viewport(640, 560)
  const before = await openFeed()
  check('640×560 视频投稿已滚到第二条', before?.videoOnly && before.scroll > 0 && before.y < 560)
  if (!before) return

  const { x, y } = before
  await page.mouseEvent({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await page.mouseEvent({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  check('通过顶栏从第二条视频详情返回', await page.clickExactText('返回'))
  const after = await waitForCard()
  check('返回后保留视频投稿筛选', after?.videoOnly)
  check(
    `返回后第二条视频恢复位置，scrollTop ${before.scroll} → ${after?.scroll}`,
    !!after && Math.abs(after.top - before.top) <= 1,
  )

  const keyboardBack = await openWithEnter()
  const keyboardReturn = await waitForCard()
  check('用 Enter 打开后返回，焦点回到第二条视频', keyboardBack && keyboardReturn?.focused)

  const refresh = await page.clickText('刷新动态')
  const refreshed = await waitForCard()
  check('主动刷新回到顶部并保留筛选', refresh && refreshed?.scroll === 0 && refreshed.videoOnly)

  await openFeed('longDynamicBody')
  const expanded = await toggleBody('展开')
  await page.evaluate(`(${cardSelector(title)}).scrollIntoView({ block: 'center' })`)
  const expandedBefore = await readCard()
  const expandedBack = await openWithEnter()
  const expandedAfter = await waitForCard()
  check(
    `展开长正文后按 Enter 打开视频，返回时保留正文、筛选、位置和焦点，卡片距视口顶部 ${expandedBefore?.top} → ${expandedAfter?.top}`,
    expanded && expandedBack &&
      expandedBefore?.bodyToggle === '收起' && expandedBefore.visible &&
      expandedAfter?.bodyToggle === '收起' && expandedAfter.visible && expandedAfter.videoOnly && expandedAfter.focused &&
      Math.abs(expandedAfter.top - expandedBefore.top) <= 1 &&
      Math.abs(expandedAfter.scroll - expandedBefore.scroll) <= 1,
  )

  const collapsed = await toggleBody('收起')
  await page.evaluate(`(${cardSelector(title)}).scrollIntoView({ block: 'center' })`)
  const collapsedBefore = await readCard()
  const collapsedBack = await openWithEnter()
  const collapsedAfter = await waitForCard()
  check(
    `收起长正文后返回，卡片距视口顶部 ${collapsedBefore?.top} → ${collapsedAfter?.top}`,
    collapsed && collapsedBack && collapsedBefore?.visible && collapsedBefore.bodyToggle === '展开' &&
      collapsedAfter?.visible && collapsedAfter.bodyToggle === '展开' && collapsedAfter.focused &&
      Math.abs(collapsedAfter.top - collapsedBefore.top) <= 1,
  )

  await openFeed('removeDynamicOnReturn')
  const removedBack = await openWithEnter()
  const neighbor = await waitForCard('【翻唱】晴天｜一人双声部')
  check('原条目删除后，返回同一筛选并聚焦相邻视频', removedBack && neighbor?.focused && neighbor.videoOnly && !(await readCard()))

  const errors = page.runtimeErrors.slice(firstError)
  check('动态返回没有控制台错误或未处理异常', errors.length === 0)
  if (errors.length) console.error(errors)
}

async function main() {
  if (!existsSync(CHROME)) {
    if (libraryPartialOnly) throw new Error(`找不到 Chrome：${CHROME}`)
    console.log('没装 Chrome，跳过')
    if (DYNAMIC_RETURN) process.exitCode = 1
    return
  }
  if (!(await reachable(WEB))) {
    console.log('dev 服务器没起：先跑 npm run web')
    process.exitCode = 1
    return
  }

  const page = await connect()
  try {
    await checkLibraryPartial(page)
    if (libraryPartialOnly) return
    await checkHeroAllocation(page)
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    if (DYNAMIC_RETURN) {
      await dynamicReturn(page)
      if (checks.some((c) => !c.ok)) process.exitCode = 1
      return
    }
    await sleep(6000)

    const heroAuthor = await page.evaluate(`(() => {
      const card = document.querySelector('[data-home-recommend] div.bili-hero-swap button')
      const authorRow = card
        ? [...card.querySelectorAll(':scope > span')].find((row) => row.textContent.includes('UP'))
        : null
      const coverStats = card
        ? [...card.querySelectorAll(':scope > span')].find((row) => row.querySelector('svg'))
        : null
      const statsOverlay = coverStats?.lastElementChild
      const countText = statsOverlay?.firstElementChild?.textContent?.trim() ?? ''
      const durationText = statsOverlay?.lastElementChild?.textContent?.trim() ?? ''
      const counts = countText.match(/\\d+(?:\\.\\d+)?万?/g) ?? []
      return {
        text: authorRow?.textContent?.trim() ?? '',
        name: authorRow?.lastElementChild?.textContent?.trim() ?? '',
        authorParts: authorRow?.children.length ?? 0,
        firstAuthorPart: authorRow?.firstElementChild?.textContent?.trim() ?? '',
        coverStats: countText + ' ' + durationText,
        coverCounts: counts.length,
      }
    })()`)
    check(
      '首页小卡作者行只留作者，播放量仍压在封面',
      heroAuthor.text.startsWith('UP') &&
        heroAuthor.authorParts === 2 &&
        heroAuthor.firstAuthorPart === 'UP' &&
        heroAuthor.name.length > 0 &&
        !heroAuthor.text.includes('播放') &&
        heroAuthor.coverStats.includes(':') &&
        heroAuthor.coverCounts >= 2,
    )

    await page.evaluate(`(() => {
      const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '设置')
      hit?.click()
    })()`)
    await sleep(700)
    const playbackDividerColors = await page.evaluate(`(() => {
      const section = [...document.querySelectorAll('section')]
        .find((node) => node.querySelector('h2')?.textContent === '播放')
      const rows = [...(section?.querySelector('div.divide-y')?.children ?? [])]
      return rows.flatMap((row) => {
        const style = getComputedStyle(row)
        return [
          [style.borderTopColor, style.borderTopWidth],
          [style.borderBottomColor, style.borderBottomWidth],
        ]
      }).filter(([, width]) => width !== '0px').map(([color]) => color)
    })()`)
    check(
      '设置页播放项使用同级浅色分隔线',
      playbackDividerColors.length > 0 && playbackDividerColors.every((color) => color === 'rgb(227, 229, 231)'),
    )
    await page.evaluate(`(() => {
      const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '发现')
      hit?.click()
    })()`)
    await sleep(1000)

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
    for (const width of [380, 420]) {
      await page.viewport(width, 560)
      await sleep(600)
      const fit = await controlFit(page)
      check(`${width} 宽控制条没有被裁切`, !!fit && fit.overflow <= 1 && fit.outside === 0)
      check(`${width} 宽保留全屏`, !!fit?.full)
      const focused = await page.evaluate(`(() => {
        const btn = document.querySelector('button[aria-label="全屏"]')
        const frame = document.querySelector('[data-watch-player]')?.getBoundingClientRect()
        if (!btn || !frame) return false
        btn.focus()
        const box = btn.getBoundingClientRect()
        return document.activeElement === btn && box.right <= frame.right + 0.5
      })()`)
      check(`${width} 宽全屏可聚焦且在画面内`, focused)
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
    await page.viewport(640, 560)
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
    const singleResult = await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="搜索结果"]')
      if (!dialog) return null
      dialog.scrollTop = dialog.scrollHeight - dialog.clientHeight
      const scrollTop = dialog.scrollTop
      const count = dialog.querySelectorAll('[data-track-card]').length
      dialog.querySelector('button[aria-label^="观看"]')?.click()
      return { scrollTop, count }
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
        scrollTop: dialog?.scrollTop,
      }
    })()`)
    check('从搜索结果返回会重新展开结果', searchVideo && returned.dialog && returned.query === '晴天')
    check('返回后焦点落回结果卡片', returned.focused)
    check(
      `单条结果保留滚动位置（${singleResult?.scrollTop} → ${returned.scrollTop}）`,
      singleResult?.count === 1 && singleResult.scrollTop > 0 && returned.scrollTop === singleResult.scrollTop,
    )

    // 再次进入同一结果：只点顶栏搜索框后按 Esc 收联想，不能抹掉返回目标。
    const reopenedResult = await page.evaluate(`(() => {
      const card = document.activeElement?.closest?.('[data-track-card]')
      const button = card?.querySelector('button[aria-label^="观看"]')
      if (!button) return false
      button.click()
      return true
    })()`)
    let reopenedVideo = false
    for (let i = 0; i < 30 && !reopenedVideo; i += 1) {
      await sleep(500)
      reopenedVideo = await page.evaluate(`!!document.querySelector('video')`)
    }
    const inputFocused = await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      if (!input) return false
      input.focus()
      return true
    })()`)
    await sleep(500)
    const suggestBeforeEsc = await page.evaluate(`!!document.querySelector('[data-search-suggest-panel]')`)
    const escSent = await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      if (!input) return false
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      return true
    })()`)
    await sleep(400)
    const suggestAfterEsc = await page.evaluate(`!!document.querySelector('[data-search-suggest-panel]')`)
    check('Esc 收起顶栏搜索联想', reopenedVideo && inputFocused && suggestBeforeEsc && escSent && !suggestAfterEsc)
    await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
    await sleep(900)
    const secondReturn = await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="搜索结果"]')
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      return {
        dialog: !!dialog,
        query: input ? input.value : '',
        focused: !!document.activeElement?.closest?.('[data-track-card]'),
      }
    })()`)
    check(
      'Esc 收联想后返回仍回结果面板与原卡片',
      secondReturn.dialog && secondReturn.query === '晴天' && secondReturn.focused,
    )

    await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      if (!input) return
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '周杰伦')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form')?.requestSubmit()
    })()`)
    let resultCount = 0
    for (let i = 0; i < 20 && resultCount < 5; i += 1) {
      await sleep(400)
      resultCount = await page.evaluate(`document.querySelectorAll('#search-scroll [data-track-card]').length`)
    }

    const filters = ['音乐', '最多播放', '10 分钟以下']
    const filtersSelected = await page.evaluate(`(() => {
      const dialog = document.querySelector('#search-scroll')
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      return ${JSON.stringify(filters)}.every((label) => {
        const button = buttons.find((button) => button.textContent.trim() === label)
        button?.click()
        return !!button
      })
    })()`)
    await sleep(1200)
    const manyResults = await page.evaluate(`(() => {
      const dialog = document.querySelector('#search-scroll')
      const cards = dialog?.querySelectorAll('[data-track-card]')
      const button = cards?.[2]?.querySelector('button[aria-label^="观看"]')
      if (!button) return null
      dialog.scrollTop = Math.floor((dialog.scrollHeight - dialog.clientHeight) / 3)
      button.focus({ preventScroll: true })
      return {
        count: cards.length,
        scrollTop: dialog.scrollTop,
        focused: document.activeElement?.getAttribute('aria-label'),
      }
    })()`)
    await page.pressSpace()
    let keyboardOpened = false
    for (let i = 0; i < 30 && !keyboardOpened; i += 1) {
      await sleep(500)
      keyboardOpened = await page.evaluate(`!!document.querySelector('video')`)
    }
    await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
    await sleep(900)
    const returnedMany = await page.evaluate(`(() => {
      const dialog = document.querySelector('#search-scroll')
      const pressed = [...(dialog?.querySelectorAll('button[aria-pressed="true"]') ?? [])]
      return {
        scrollTop: dialog?.scrollTop,
        focused: document.activeElement?.getAttribute('aria-label'),
        query: document.querySelector('input[aria-label="顶栏搜索"]')?.value,
        filters: pressed.map((button) => button.textContent.trim()),
      }
    })()`)
    check(
      `多条结果保留滚动位置（${manyResults?.scrollTop} → ${returnedMany.scrollTop}）`,
      keyboardOpened && manyResults?.count === 5 && manyResults.scrollTop > 0 && returnedMany.scrollTop === manyResults.scrollTop,
    )
    check('键盘打开后焦点回到同一张结果卡片', keyboardOpened && !!manyResults?.focused && returnedMany.focused === manyResults.focused)
    check(
      '返回后保留关键词、分区、排序和时长',
      filtersSelected && returnedMany.query === '周杰伦' && filters.every((filter) => returnedMany.filters.includes(filter)),
    )
    await page.evaluate(`document.querySelector('#search-scroll button[aria-label="关闭搜索"]')?.click()`)
    check(
      '主动关闭搜索后露出原页面',
      await page.evaluate(`!document.querySelector('#search-scroll') && !!document.querySelector('[data-home-recommend]')`),
    )
    await page.viewport(1320, 900)

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
    await page.viewport(380, 560)
    await sleep(600)
    const multiFit380 = await controlFit(page)
    check('380 宽多 P 控制条没有被裁切', !!multiFit380 && multiFit380.overflow <= 1 && multiFit380.outside === 0)
    check('380 宽多 P 保留全屏', !!multiFit380?.full)
    await page.viewport(1320, 900)
    await sleep(400)
    await page.evaluate(`(() => {
      window.__copied = ''
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window.__copied = text } },
      })
      return true
    })()`)
    await page.clickText('分享')
    await sleep(700)
    const shareLinkClicked = await page.evaluate(`(() => {
      const hit = [...document.querySelectorAll('button')].find((b) =>
        (b.textContent || '').trim() === '获取视频分享链接')
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(200)
    const shareLinkParams = await page.evaluate(`(() => {
      try { return { p: new URL(window.__copied).searchParams.get('p') } } catch { return null }
    })()`)
    check('分享面板复制链接带 p=2', shareLinkClicked && shareLinkParams?.p === '2')
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
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(400)
    const titleLinkCopied = await page.evaluate(`(() => {
      const hit = document.querySelector('button[title="复制 BV 号与链接"]')
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(200)
    const titleLinkParams = await page.evaluate(`(() => {
      try { return { p: new URL(window.__copied).searchParams.get('p') } } catch { return null }
    })()`)
    check('标题下复制 BV 号带 p=2', titleLinkCopied && titleLinkParams?.p === '2')

    const contextOpened = await page.evaluate(`(() => {
      const player = document.querySelector('[data-watch-player]')
      if (!player) return false
      const box = player.getBoundingClientRect()
      player.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 240,
        clientY: box.top + 160,
      }))
      return true
    })()`)
    await sleep(300)
    const contextMenuOpen = await page.evaluate(`!!document.querySelector('[data-shot-menu]')`)
    const rightLinkClicked = await page.clickExactText('复制视频网址')
    await sleep(200)
    const rightLinkParams = await page.evaluate(`(() => {
      try { return { p: new URL(window.__copied).searchParams.get('p') } } catch { return null }
    })()`)
    check(
      '播放器右键复制网址带 p=2',
      contextOpened && contextMenuOpen && rightLinkClicked && rightLinkParams?.p === '2',
    )

    await page.evaluate(`document.querySelector('button[aria-label="选集"]')?.click()`)
    await sleep(300)
    const switchedP1 = await page.evaluate(`(() => {
      const panel = [...document.querySelectorAll('[data-watch-pages]')].find((el) => el.getClientRects().length > 0)
      const first = panel?.querySelector('ol li button')
      if (!first) return false
      first.click()
      return true
    })()`)
    await sleep(1600)
    const p1Copied = await page.evaluate(`(() => {
      const hit = document.querySelector('button[title="复制 BV 号与链接"]')
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(200)
    const p1Url = await page.evaluate(`(() => {
      try { const url = new URL(window.__copied); return { path: url.pathname, p: url.searchParams.get('p') } } catch { return null }
    })()`)
    check('P1 复制保持不带 p', switchedP1 && p1Copied && p1Url !== null && p1Url.p === null && p1Url.path.startsWith('/video/'))

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
    const historySpacing = await page.evaluate(`(() => {
      const groups = [...document.querySelectorAll('#scroll-main section')]
      const first = groups[0]
      const second = groups[1]
      if (!first || !second) return null
      const cards = [...first.querySelectorAll('[data-track-card]')]
      const lastCard = cards.at(-1)
      const nextHeading = second.querySelector('h2')
      const grid = cards[0]?.parentElement
      const sentinel = grid?.querySelector(':scope > [aria-hidden]')
      return {
        gap:
          lastCard && nextHeading
            ? nextHeading.getBoundingClientRect().top - lastCard.getBoundingClientRect().bottom
            : null,
        sentinel: sentinel
          ? {
              position: getComputedStyle(sentinel).position,
              display: getComputedStyle(sentinel).display,
            }
          : null,
      }
    })()`)
    check(
      '历史日期组只留一层间距，预取哨兵不占行',
      historySpacing &&
        historySpacing.gap >= 24 &&
        historySpacing.gap <= 32 &&
        historySpacing.sentinel?.position === 'absolute' &&
        historySpacing.sentinel.display !== 'none',
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

    // UP 主分页重叠：mock 第 2 页重复 102 并新增 103，第 3 页整页重复。
    // 按 mid 去重后应得到 101、102、103，且整页重叠也要继续翻到空页收尾。
    await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '重叠')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form')?.requestSubmit()
      return true
    })()`)
    let overlapUsers = []
    for (let i = 0; i < 20 && overlapUsers.length !== 2; i += 1) {
      await sleep(300)
      overlapUsers = await page.evaluate(
        `[...document.querySelectorAll('[data-user-mid]')].map((el) => Number(el.dataset.userMid))`,
      )
    }
    check('重叠分页首屏有两条 UP 主', overlapUsers.join(',') === '101,102')
    await page.clickExactText('UP 主')
    await sleep(200)
    const clickMoreUsers = () =>
      page.evaluate(`(() => {
        const hit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '更多 UP 主')
        if (!hit || hit.disabled) return false
        hit.click()
        return true
      })()`)
    const readUserMids = () =>
      page.evaluate(
        `[...document.querySelectorAll('[data-user-mid]')].map((el) => Number(el.dataset.userMid))`,
      )
    await clickMoreUsers()
    for (let i = 0; i < 20 && (await readUserMids()).length !== 3; i += 1) await sleep(200)
    check('重叠页按 mid 去重并追加新 UP 主', (await readUserMids()).join(',') === '101,102,103')
    await clickMoreUsers()
    await sleep(500)
    check('整页重叠不卡住页码', (await readUserMids()).join(',') === '101,102,103')
    await clickMoreUsers()
    let usersEnded = false
    for (let i = 0; i < 20 && !usersEnded; i += 1) {
      await sleep(200)
      usersEnded = await page.evaluate(
        `![...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '更多 UP 主')`,
      )
    }
    check('翻到空页后收起「更多 UP 主」', usersEnded)

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

    const readTransportDirection = (scope) =>
      page.evaluate(`(() => {
        const root = ${scope}
        const read = (label) => {
          const button = root?.querySelector('button[aria-label=' + JSON.stringify(label) + ']')
          const paths = button ? [...button.querySelectorAll('svg path')] : []
          if (paths.length !== 2) return null
          const bar = paths[0].getBBox()
          const triangle = paths[1].getBBox()
          const apex = paths[1].getPointAtLength(0)
          return {
            label,
            lineLeft: bar.x < triangle.x,
            lineRight: bar.x > triangle.x + triangle.width,
            apexLeft: Math.abs(apex.x - triangle.x) < 0.5,
            apexRight: Math.abs(apex.x - (triangle.x + triangle.width)) < 0.5,
          }
        }
        return [read('上一首'), read('下一首')]
      })()`)
    const barDirection = await readTransportDirection(
      `document.querySelector('button[aria-label="打开播放舞台"]')?.closest('section')`,
    )
    const openedStage = await page.evaluate(`(() => {
      const hit = document.querySelector('button[aria-label="打开播放舞台"]')
      hit?.click()
      return !!hit
    })()`)
    await sleep(500)
    const stageDirection = await readTransportDirection(`document.querySelector('.stage')`)
    check(
      '底栏和舞台的上一首、下一首图标方向一致',
      openedStage &&
        barDirection.every(Boolean) &&
        stageDirection.every(Boolean) &&
        [...barDirection, ...stageDirection].every(({ label, lineLeft, lineRight, apexLeft, apexRight }) =>
          label === '上一首'
            ? lineLeft && !lineRight && apexLeft && !apexRight
            : lineRight && !lineLeft && apexRight && !apexLeft,
        ),
    )
    await page.evaluate(`document.querySelector('button[aria-label="退出舞台"]')?.click()`)
    await sleep(300)

    await page.viewport(380, 560)
    const narrowPlayer = await page.evaluate(`(() => {
      const bar = document.querySelector('button[aria-label="打开播放舞台"]')?.closest('section')
      const title = bar?.querySelector('.bili-marquee')
      const queue = bar?.querySelector('button[aria-label="播放队列"]')
      if (!bar || !title || !queue) return null
      const barBox = bar.getBoundingClientRect()
      const titleBox = title.getBoundingClientRect()
      const queueBox = queue.getBoundingClientRect()
      queue.focus()
      return {
        overflow: bar.scrollWidth - bar.clientWidth,
        barInside: barBox.left >= 0 && barBox.right <= window.innerWidth,
        titleWidth: titleBox.width,
        titleVisible:
          getComputedStyle(title).visibility !== 'hidden' &&
          Number(getComputedStyle(title).opacity) > 0.5 &&
          getComputedStyle(title).color !== 'rgba(0, 0, 0, 0)',
        queueInside: queueBox.left >= barBox.left && queueBox.right <= barBox.right,
        queueTabIndex: queue.tabIndex,
        queueDisabled: queue.disabled,
        queueFocused: document.activeElement === queue,
        queueCenter: [queueBox.left + queueBox.width / 2, queueBox.top + queueBox.height / 2],
      }
    })()`)
    await page.pressSpace()
    await sleep(400)
    const narrowQueueOpened = await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="播放详情"]')
      return {
        open: !!dialog,
        focusInside: !!dialog && dialog.contains(document.activeElement),
        initialFocus: document.activeElement?.getAttribute('aria-label') ?? '',
      }
    })()`)
    const focusWraps = await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="播放详情"]')
      if (!dialog) return false
      const focusable = [...dialog.querySelectorAll('button:not([disabled]):not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0)
      if (focusable.length < 2) return false
      focusable[0].focus()
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      )
      return document.activeElement === focusable.at(-1)
    })()`)
    await page.evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
    )
    await sleep(300)
    const queueClosedByKey = await page.evaluate(`(() => ({
      closed: !document.querySelector('[role="dialog"][aria-label="播放详情"]'),
      focusReturned: document.activeElement === document.querySelector('button[aria-label="播放队列"]'),
    }))()`)
    await clickAt(narrowPlayer.queueCenter[0], narrowPlayer.queueCenter[1])
    const queueOpenedByMouse = await page.evaluate(
      `!!document.querySelector('[role="dialog"][aria-label="播放详情"]')`,
    )
    await page.evaluate(
      `document.querySelector('[role="dialog"][aria-label="播放详情"] button[aria-label="关闭详情"]')?.click()`,
    )
    await sleep(300)
    const openedNarrowStage = await page.evaluate(`(() => {
      const hit = document.querySelector('button[aria-label="打开播放舞台"]')
      hit?.click()
      return !!hit
    })()`)
    await sleep(400)
    const narrowStageControls = await page.evaluate(`(() => {
      const visible = (label) => {
        const button = document.querySelector('.stage button[aria-label="' + label + '"]')
        return !!button && button.getClientRects().length > 0 && button.getBoundingClientRect().width > 0
      }
      return visible('随机播放') || visible('关闭随机播放')
        ? visible('循环：关') || visible('循环：列表') || visible('循环：单曲')
        : false
    })()`)
    await page.evaluate(`document.querySelector('button[aria-label="退出舞台"]')?.click()`)
    await sleep(300)
    const narrowResult = {
      layout:
        narrowPlayer &&
        narrowPlayer.overflow === 0 &&
        narrowPlayer.barInside &&
        narrowPlayer.titleWidth >= 120 &&
        narrowPlayer.titleVisible &&
        narrowPlayer.queueInside &&
        narrowPlayer.queueTabIndex === 0 &&
        !narrowPlayer.queueDisabled &&
        narrowPlayer.queueFocused,
      keyboard:
        narrowQueueOpened.open &&
        narrowQueueOpened.focusInside &&
        narrowQueueOpened.initialFocus === '关闭详情' &&
        focusWraps &&
        queueClosedByKey.closed &&
        queueClosedByKey.focusReturned,
      mouse: queueOpenedByMouse,
      stage: openedNarrowStage && narrowStageControls,
      closed: !(await page.evaluate(
        `!!document.querySelector('[role="dialog"][aria-label="播放详情"]')`,
      )),
    }
    check(
      '380 宽播放条保留曲名和队列，键盘可打开队列',
      Object.values(narrowResult).every(Boolean),
    )
    if (!Object.values(narrowResult).every(Boolean)) console.log(JSON.stringify({ narrowPlayer, narrowQueueOpened, narrowResult }))
    await page.viewport(1320, 900)
    await page.evaluate(`(() => {
      if (document.querySelector('.rail-slot')?.dataset.open === 'false') {
        document.querySelector('button[aria-label="歌词栏"]')?.click()
      }
    })()`)
    await sleep(300)
    await page.evaluate(`document.querySelector('button[aria-label="播放队列"]')?.click()`)
    await sleep(300)
    const desktopQueueOpened = await page.evaluate(
      `document.querySelector('.rail-slot')?.dataset.open === 'true'`,
    )
    const desktopFocusKept = await page.evaluate(`(() => {
      const stageButton = document.querySelector('button[aria-label="打开播放舞台"]')
      stageButton?.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      return document.activeElement === stageButton
    })()`)
    await sleep(300)
    check(
      '桌面关闭队列不抢走播放舞台的焦点',
      desktopQueueOpened &&
        desktopFocusKept &&
        (await page.evaluate(`document.querySelector('.rail-slot')?.dataset.open === 'false'`)) &&
        (await page.evaluate(
          `document.activeElement === document.querySelector('button[aria-label="打开播放舞台"]')`,
        )),
    )
    if (!desktopQueueOpened || !desktopFocusKept) console.log(JSON.stringify({ desktopQueueOpened, desktopFocusKept }))
    await page.evaluate(`document.querySelector('button[aria-label="歌词栏"]')?.click()`)
    await sleep(300)

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

    // 播放队列：清空仍是一次点击，随后给出带数量的撤销。
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    await sleep(5000)
    const startedListen = await page.evaluate(`(() => {
      const hit = document.querySelector('button[aria-label^="听 "]')
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
    // 撤销窗口挂在队列层，切到歌词再切回来不能丢。
    await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const tab = [...(rail?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim() === '歌词')
      tab?.click()
    })()`)
    await sleep(400)
    await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const tab = [...(rail?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim().startsWith('队列'))
      tab?.click()
    })()`)
    await sleep(400)
    check(
      '切到歌词再回来撤销仍在',
      (await page.evaluate(`document.querySelector('[data-queue-undo]')?.textContent?.trim() ?? ''`)).includes('撤销'),
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
    const beforeRemove = await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const rows = [...(rail?.querySelectorAll('[data-queue-remove]') ?? [])]
      const current = rail?.querySelector('[role="button"][aria-current="true"]')
      const target = rows[1]
      if (!target) return null
      target.focus()
      return {
        count: rows.length,
        current: (current?.textContent || '').trim(),
        next: rows[2]?.getAttribute('aria-label') || '',
      }
    })()`)
    await page.pressSpace()
    await sleep(800)
    const afterRemove = await page.evaluate(`(() => {
      const rail = document.querySelector('[aria-label="播放右栏"]')
      const rows = [...(rail?.querySelectorAll('[data-queue-remove]') ?? [])]
      const current = rail?.querySelector('[role="button"][aria-current="true"]')
      return {
        count: rows.length,
        current: (current?.textContent || '').trim(),
        focus: document.activeElement?.getAttribute('aria-label') || '',
      }
    })()`)
    check(
      '键盘移除单曲且不切歌、焦点落到下一项',
      beforeRemove &&
        afterRemove.count === beforeRemove.count - 1 &&
        afterRemove.current === beforeRemove.current &&
        afterRemove.focus === beforeRemove.next,
    )

    // 首页慢请求：8 秒只提示慢，10 秒成功仍要展示；重试后旧响应按请求 id 丢弃。
    await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?slowHome=1`)}`)
    let homeSlow = false
    for (let i = 0; i < 40 && !homeSlow; i += 1) {
      await sleep(300)
      homeSlow = await page.evaluate(
        `!!document.querySelector('[data-home-slow]') && document.body.innerText.includes('加载较慢')`,
      )
    }
    check(
      '慢推荐 8 秒显示加载较慢与重试',
      homeSlow && !(await page.evaluate(`document.body.innerText.includes('连不上 B 站')`)),
    )
    const retriedSlow = await page.evaluate(`(() => {
      const hit = document.querySelector('[data-home-retry]')
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(300)
    const afterRetry = await page.evaluate(`({
      slow: !!document.querySelector('[data-home-slow]'),
      recommend: !!document.querySelector('[data-home-recommend]'),
      loading: document.body.innerText.includes('正在取推荐'),
    })`)
    check('重试立即发起新尝试并清掉慢状态', retriedSlow && !afterRetry.slow && afterRetry.loading && !afterRetry.recommend)
    await sleep(2200)
    const staleResult = await page.evaluate(`({
      slow: !!document.querySelector('[data-home-slow]'),
      recommend: !!document.querySelector('[data-home-recommend]'),
      loading: document.body.innerText.includes('正在取推荐'),
    })`)
    check('旧请求成功后不回填已作废的尝试', !staleResult.recommend && !staleResult.slow && staleResult.loading)
    let secondSlow = false
    for (let i = 0; i < 40 && !secondSlow; i += 1) {
      await sleep(300)
      secondSlow = await page.evaluate(`!!document.querySelector('[data-home-slow]')`)
    }
    check('新尝试到 8 秒仍会提示较慢', secondSlow)
    let homeRecovered = false
    for (let i = 0; i < 40 && !homeRecovered; i += 1) {
      await sleep(300)
      homeRecovered = await page.evaluate(`(() => {
        return !!document.querySelector('[data-home-recommend]') && !document.querySelector('[data-home-slow]') && !document.body.innerText.includes('连不上 B 站')
      })()`)
    }
    check('10 秒成功仍展示推荐', homeRecovered)

    // 请求级失败（真实断网最终走到的路径）：应立刻报错，不要等到 8 秒慢提示。
    await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?failHome=1`)}`)
    await sleep(1200)
    const failedHome = await page.evaluate(`({
      error: document.body.innerText.includes('连不上 B 站，检查一下网络。'),
      slow: !!document.querySelector('[data-home-slow]'),
      retry: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '重新取一次'),
    })`)
    check('请求失败立即报错且不显示加载较慢', failedHome.error && !failedHome.slow && failedHome.retry)

    await checkListErrors(page)
  } finally {
    page.close()
    if (checks.some((c) => !c.ok)) process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
