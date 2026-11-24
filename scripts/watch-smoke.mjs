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
const channelOnly = process.argv.includes('--channel-nav')
const topbarOnly = process.argv.includes('--topbar-only')
const liveOnly = process.argv.includes('--live-only')
const tripleOnly = process.argv.includes('--triple-only')
const rankingSkeletonOnly = process.argv.includes('--ranking-skeleton-only')
const popularPagingOnly = process.argv.includes('--popular-paging-only')
const libraryEmptyOnly = process.argv.includes('--library-empty-only')
const profileOnly = process.argv.includes('--profile-only')
const followingOnly = process.argv.includes('--following-only')
const PORT = Number(process.env.SMOKE_CDP_PORT || (DYNAMIC_RETURN ? 9324 : 9224))
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32'
  ? join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe')
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function luminance(color) {
  const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number)
  const linear = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrastRatio(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

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
      ...(process.argv.includes('--typography-only') && process.env.TYPOGRAPHY_HEADED === '1' ? [] : ['--headless=new']),
      '--disable-gpu',
      '--no-first-run',
      // 无头窗口会被 Chrome 当成被遮挡，WAAPI 动画会停在 0 秒；舞台过渡的检查需要它持续运行。
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-background-networking',
      ...(DYNAMIC_RETURN || libraryPartialOnly
        ? ['--proxy-server=http://127.0.0.1:1']
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
  await send('Target.activateTarget', { targetId: target.result.targetId })
  const attached = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true })
  const sid = attached.result.sessionId
  await send('Runtime.enable', {}, sid)
  // 无头 Chrome 仍可能被 chrome://settings/help 抢走前台，页面一隐藏 WAAPI 就停住。
  const keepActive = setInterval(() => {
    void send('Page.setWebLifecycleState', { state: 'active' }, sid).then((result) => {
      if (result.error) return
      void send('Target.getTargets').then((targets) => {
        for (const info of targets.result?.targetInfos ?? []) {
          if (info.type === 'page' && info.url.startsWith('chrome://settings')) {
            void send('Target.closeTarget', { targetId: info.targetId })
          }
        }
      })
    })
  }, 1500)
  const typography = process.argv.includes('--typography-only')
  const nativeScale = typography ? (await send('Runtime.evaluate', { expression: 'devicePixelRatio' }, sid)).result.result.value : 1
  await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 900, deviceScaleFactor: nativeScale, mobile: false }, sid)

  const viewport = async (width, height) => {
    await send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: nativeScale, mobile: false },
      sid,
    )
    // Chrome 可能先确认窗口尺寸，下一帧才派发 resize；等布局落定再点会随窗口关闭的浮层。
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
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
    cdp: (method, params) => send(method, params, sid),
    nativeScale,
    errors,
    runtimeErrors: errors,
    viewport,
    emulateMedia: (features) => send('Emulation.setEmulatedMedia', { media: '', features }, sid),
    doubleClick,
    pressSpace,
    mouseEvent: (params) => send('Input.dispatchMouseEvent', params, sid),
    keyEvent: (params) => send('Input.dispatchKeyEvent', params, sid),
    clickText,
    clickExactText,
    close: () => {
      clearInterval(keepActive)
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

async function checkLibraryShelf(page) {
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(5000)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '曲库')
    hit?.click()
  })()`)
  let ready = false
  for (let i = 0; i < 30 && !ready; i += 1) {
    await sleep(200)
    ready = await page.evaluate(`document.querySelectorAll('[data-playlist-name]').length === 6`)
  }
  const read = () =>
    page.evaluate(`[...document.querySelectorAll('[data-playlist-name]')].map((card) => {
      const sleeve = card.querySelector('[data-cover-count]')
      const play = card.querySelector('button[aria-label^="播放歌单"]')
      const sleeveBox = sleeve.getBoundingClientRect()
      const playBox = play.getBoundingClientRect()
      return {
        name: card.dataset.playlistName,
        covers: Number(sleeve.dataset.coverCount),
        width: sleeveBox.width,
        height: sleeveBox.height,
        playDisabled: play.disabled,
        playOpacity: getComputedStyle(play).opacity,
        playInside: playBox.right <= sleeveBox.right + 0.5 && playBox.left >= sleeveBox.left - 0.5,
        countTop: card.querySelector('[data-track-count]')?.getBoundingClientRect().top ?? -1,
        text: card.innerText,
      }
    })`)
  const shelf = await read()
  const byName = (name) => shelf.find((card) => card.name === name)
  check(
    '曲库封套按 1、2、3、4、0 张封面分别排版',
    ready &&
      byName('单曲循环 · 今晚只听这一首')?.covers === 1 &&
      byName('双声部现场')?.covers === 2 &&
      byName('纯音乐与白噪音')?.covers === 3 &&
      byName('深夜循环')?.covers === 4 &&
      byName('暂时空着的歌单')?.covers === 0,
  )
  check(
    '封套保持方形、播放键在封套内',
    shelf.every(
      (card) =>
        Math.abs(card.width - card.height) <= 1 &&
        card.width >= 150 &&
        card.playInside,
    ),
  )
  check(
    '空歌单不能播放，其他歌单显示曲目数',
    shelf.every(
      (card) =>
        card.playDisabled === (card.name === '暂时空着的歌单') &&
        card.text.includes(card.name) &&
        (card.playDisabled ? card.text.includes('空歌单') : /\d+ 首/.test(card.text)),
    ),
  )
  check(
    '曲目数在同排封套下对齐',
    new Set(shelf.map((card) => Math.round(card.countTop))).size === 1,
  )

  const firstCenter = await page.evaluate(`(() => {
    const card = document.querySelector('[data-playlist-name="深夜循环"]')
    const play = card?.querySelector('button[aria-label^="播放歌单"]')
    const box = play?.getBoundingClientRect()
    return box ? [box.left + box.width / 2, box.top + box.height / 2] : null
  })()`)
  if (firstCenter) {
    await page.mouseEvent({ type: 'mouseMoved', x: firstCenter[0], y: firstCenter[1] })
    await sleep(250)
  }
  const hoveredPlay = await page.evaluate(
    `getComputedStyle(document.querySelector('[data-playlist-name="深夜循环"] button[aria-label^="播放歌单"]')).opacity`,
  )
  check('鼠标移到歌单卡时播放全部显形', hoveredPlay === '1')
  await page.mouseEvent({ type: 'mouseMoved', x: 4, y: 4 })
  const focusedPlay = await page.evaluate(`(() => {
    const play = document.querySelector('[data-playlist-name="深夜循环"] button[aria-label^="播放歌单"]')
    play?.focus()
    return play ? getComputedStyle(play).opacity : null
  })()`)
  check('键盘聚焦播放全部时按钮可见', focusedPlay === '1')

  const started = await page.evaluate(`(() => {
    const play = document.querySelector('[data-playlist-name="深夜循环"] button[aria-label^="播放歌单"]')
    play?.click()
    return !!play
  })()`)
  let playerReady = false
  for (let i = 0; i < 20 && !playerReady; i += 1) {
    await sleep(250)
    playerReady = await page.evaluate(`!!document.querySelector('button[aria-label="打开播放舞台"]')`)
  }
  check('播放全部从封套开始组队列', started && playerReady)

  const openedDetail = await page.evaluate(`(() => {
    const title = document.querySelector('[data-playlist-name="深夜循环"] [title="深夜循环"]')
    title?.closest('button')?.click()
    return !!title
  })()`)
  let detailReady = false
  for (let i = 0; i < 20 && !detailReady; i += 1) {
    await sleep(200)
    detailReady = await page.evaluate(`document.querySelectorAll('#scroll-main [data-cover-count]').length === 1`)
  }
  const detail = await page.evaluate(`(() => {
    const sleeve = document.querySelector('#scroll-main [data-cover-count]')
    return {
      covers: Number(sleeve?.dataset.coverCount),
      title: document.querySelector('#scroll-main h2')?.textContent?.trim() ?? '',
    }
  })()`)
  check(
    '歌单详情复用同一封套',
    openedDetail && detailReady && detail.covers === 4 && detail.title === '深夜循环',
  )

  await page.viewport(380, 800)
  const brokenUrl = new URL(WEB)
  brokenUrl.searchParams.set('libraryBrokenCover', '1')
  await page.evaluate(`location.href = ${JSON.stringify(brokenUrl.href)}`)
  await sleep(5000)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '曲库')
    hit?.click()
  })()`)
  await sleep(800)
  const narrow = await read()
  let fallbackReady = false
  for (let i = 0; i < 20 && !fallbackReady; i += 1) {
    await sleep(200)
    fallbackReady = await page.evaluate(`(() => {
      const card = document.querySelector('[data-playlist-name="单曲循环 · 今晚只听这一首"]')
      return card?.querySelector('[data-cover-count]')?.dataset.coverCount === '0' &&
        !!card.querySelector('[data-playlist-fallback]')
    })()`)
  }
  check(
    '窄窗和无悬停设备保留可读封套与播放全部，坏图回落字标',
    narrow.length === 6 &&
      narrow.every((card) => card.width >= 140 && card.playInside) &&
      narrow.every((card) => card.playDisabled || card.playOpacity === '1') &&
      fallbackReady &&
      !(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`)),
  )

  const openedLongDetail = await page.evaluate(`(() => {
    const title = document.querySelector('[data-playlist-name="单曲循环 · 今晚只听这一首"] [title="单曲循环 · 今晚只听这一首"]')
    title?.closest('button')?.click()
    return !!title
  })()`)
  let longDetailReady = false
  for (let i = 0; i < 20 && !longDetailReady; i += 1) {
    await sleep(200)
    longDetailReady = await page.evaluate(`document.querySelectorAll('#scroll-main h2').length > 0`)
  }
  const longDetail = await page.evaluate(`(() => {
    const title = document.querySelector('#scroll-main h2')
    const box = title?.getBoundingClientRect()
    return box ? { width: box.width, height: box.height } : null
  })()`)
  check(
    '窄窗歌单详情的标题和操作不互相挤压',
    openedLongDetail && longDetailReady && longDetail && longDetail.width >= 220 && longDetail.height <= 64,
  )
  await page.viewport(1320, 900)
}

async function checkStageMoments(page) {
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?multiP=1`)}`)
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i += 1) {
      if (await page.evaluate(expression)) return true
      await sleep(80)
    }
    return false
  }
  await waitFor(`location.search.includes('multiP') && !!document.querySelector('main h2')`)
  await page.evaluate(`Promise.all([import('/src/app/appStore.ts'), import('/src/shared/lib/mockCatalog.ts')])
    .then(([app, catalog]) => app.useAppStore.getState().navigate({
      kind: 'watch', track: catalog.trackByTitle('漠河舞厅'), page: 2,
    }))`)
  const canListen = await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '听视频')`)
  if (canListen) await page.clickExactText('听视频')
  await waitFor(`!!document.querySelector('[aria-label="打开播放舞台"]')`)
  await page.evaluate(`document.querySelector('[aria-label="打开播放舞台"]')?.click()`)
  const moment = `document.querySelector('.stage button[aria-label="跳到 0:19，尾奏适合循环"]')`
  const correctPart = await waitFor(`!!${moment}`)
  check('无歌词时只用当前 P 的弹幕选听点', correctPart &&
    await page.evaluate(`document.querySelector('.stage [aria-label="弹幕听点"]').innerText.includes('这段变奏好喜欢')`))
  if (!correctPart) return
  check('中点是倒数或标点时改选附近原话，计数仍包含六条弹幕',
    await page.evaluate(`document.querySelector('.stage button[aria-label="跳到 0:05，这段变奏好喜欢"]')?.innerText.includes('6 条')`))
  await page.evaluate(`document.querySelector('.stage button[aria-label="暂停"]')?.click()`)
  await page.evaluate(`${moment}.click()`)
  check('点弹幕听点定位到原话时间，同时标出当前片段', await waitFor(`
    ${moment}.getAttribute('aria-current') === 'time' &&
    document.querySelector('.stage [aria-label="播放进度"]').getAttribute('aria-valuetext') === '0:19'`))
  await page.evaluate(`document.querySelector('.stage button[aria-label="关闭弹幕"]')?.click()`)
  check('舞台关闭弹幕后不再列出观众原话', await waitFor(`
    !document.querySelector('.stage [aria-label="弹幕听点"]') && document.querySelector('.stage')?.innerText.includes('暂无匹配歌词')`))
  await page.evaluate(`document.querySelector('.stage button[aria-label="打开弹幕"]')?.click()`)
}

async function checkStageLyrics(page) {
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(6000)
  const listen = await page.evaluate(`(() => {
    const hit = document.querySelector('button[aria-label^="听 "]')
    hit?.click()
    return !!hit
  })()`)
  let stageReady = false
  for (let i = 0; i < 20 && !stageReady; i += 1) {
    await sleep(200)
    stageReady = await page.evaluate(`!!document.querySelector('button[aria-label="打开播放舞台"]')`)
  }
  await page.evaluate(`(() => {
    if (document.querySelector('.rail-slot')?.dataset.open === 'false') {
      document.querySelector('button[aria-label="歌词栏"]')?.click()
    }
  })()`)
  await sleep(250)
  await page.evaluate(`document.querySelector('button[aria-label="打开播放舞台"]')?.click()`)
  let lyricsReady = false
  for (let i = 0; i < 30 && !lyricsReady; i += 1) {
    await sleep(200)
    lyricsReady = await page.evaluate(
      `!!document.querySelector('[data-stage-lyrics] button[data-current]')`,
    )
  }
  check(
    '在线曲目的听歌舞台可以直接看当前视频',
    await page.evaluate(`[...document.querySelectorAll('.stage button')].some(button => button.textContent.trim() === '看视频')`),
  )
  const openedFocus = await page.evaluate(`(() => ({
    label: document.activeElement?.getAttribute('aria-label'),
    inside: !!document.querySelector('.stage')?.contains(document.activeElement),
  }))()`)
  await page.keyEvent({ type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
  await page.keyEvent({ type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
  await sleep(100)
  const tabFocusInside = await page.evaluate(
    `!!document.querySelector('.stage')?.contains(document.activeElement)`,
  )
  check(
    '打开舞台先聚焦退出键，Tab 不进入被遮住的底栏',
    openedFocus.label === '退出舞台' && openedFocus.inside && tabFocusInside,
  )
  const stage = await page.evaluate(`(() => {
    const root = document.querySelector('.stage')
    const lyrics = document.querySelector('[data-stage-lyric-scroll]')
    const box = lyrics?.getBoundingClientRect()
    return root && box
      ? {
          columns: getComputedStyle(root.querySelector('.grid')).gridTemplateColumns,
          width: box.width,
          height: box.height,
          active: root.querySelector('button[data-current]')?.textContent?.trim() ?? '',
          lines: root.querySelectorAll('[data-stage-lyric-scroll] button').length,
        }
      : null
  })()`)
  check(
    '舞台宽窗为封面与歌词双栏',
    listen &&
      stageReady &&
      lyricsReady &&
      stage &&
      stage.active.length > 0 &&
      stage.lines > 1 &&
      stage.width >= 450 &&
      stage.columns.split(' ').length === 2,
  )
  await page.evaluate(`document.querySelector('[data-stage-lyric-scroll]')?.focus()`)
  const playLabelBefore = await page.evaluate(
    `document.querySelector('.stage button[aria-label="暂停"], .stage button[aria-label="播放"]')?.getAttribute('aria-label') ?? ''`,
  )
  await page.keyEvent({
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    text: ' ',
    unmodifiedText: ' ',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  })
  await page.keyEvent({
    type: 'keyUp',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  })
  await sleep(250)
  const playLabelAfter = await page.evaluate(
    `document.querySelector('.stage button[aria-label="暂停"], .stage button[aria-label="播放"]')?.getAttribute('aria-label') ?? ''`,
  )
  await page.keyEvent({
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    text: ' ',
    unmodifiedText: ' ',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  })
  await page.keyEvent({
    type: 'keyUp',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  })
  const progressBeforeShortcut = await page.evaluate(
    `document.querySelector('[aria-label="播放进度"]')?.getAttribute('aria-valuenow') ?? ''`,
  )
  await page.keyEvent({
    type: 'keyDown',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 39,
  })
  await page.keyEvent({
    type: 'keyUp',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 39,
  })
  await sleep(250)
  const progressAfterShortcut = await page.evaluate(
    `document.querySelector('[aria-label="播放进度"]')?.getAttribute('aria-valuenow') ?? ''`,
  )
  check(
    '舞台歌词聚焦时空格和方向键仍控制播放',
    playLabelBefore !== '' &&
      playLabelAfter !== playLabelBefore &&
      progressAfterShortcut !== progressBeforeShortcut,
  )
  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await sleep(150)
  const reducedMotion = await page.evaluate(`(() => {
    const disc = document.querySelector('.stage-vinyl')
    return {
      disc: disc ? getComputedStyle(disc).animationName : 'none',
      line: getComputedStyle(document.querySelector('.stage-vinyl') ?? document.body).animationName,
    }
  })()`)
  check('减少动态效果时关闭舞台旋转', reducedMotion.disc === 'none' && reducedMotion.line === 'none')

  const related = await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.stage button')]
      .find((button) => (button.textContent || '').trim() === '相关推荐')
    hit?.click()
    return !!hit
  })()`)
  await sleep(250)
  const relatedOpen = await page.evaluate(`!!document.querySelector('[data-stage-related]')`)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.stage button')]
      .find((button) => (button.textContent || '').trim() === '相关推荐')
    hit?.click()
  })()`)
  await sleep(200)
  const relatedClosed = await page.evaluate(`!document.querySelector('[data-stage-related]')`)
  check('相关推荐从舞台收进可展开入口', related && relatedOpen && relatedClosed)

  const scrollBox = await page.evaluate(`(() => {
    const box = document.querySelector('[data-stage-lyric-scroll]')?.getBoundingClientRect()
    return box ? [box.left + box.width / 2, box.top + box.height / 2] : null
  })()`)
  const beforeBrowsing = await page.evaluate(`(() => ({
    scrollTop: document.querySelector('[data-stage-lyric-scroll]')?.scrollTop ?? -1,
    volume: document.querySelector('[aria-label="音量"]')?.getAttribute('aria-valuenow') ?? '',
    progress: document.querySelector('[aria-label="播放进度"]')?.getAttribute('aria-valuenow') ?? '',
  }))()`)
  if (scrollBox) {
    await page.mouseEvent({ type: 'mouseMoved', x: scrollBox[0], y: scrollBox[1] })
    await page.mouseEvent({
      type: 'mouseWheel',
      x: scrollBox[0],
      y: scrollBox[1],
      deltaX: 0,
      deltaY: -240,
    })
  }
  await sleep(300)
  await page.evaluate(`document.querySelector('[data-stage-lyric-scroll]')?.focus()`)
  await page.keyEvent({
    type: 'keyDown',
    key: 'ArrowUp',
    code: 'ArrowUp',
    windowsVirtualKeyCode: 38,
    nativeVirtualKeyCode: 38,
  })
  await page.keyEvent({
    type: 'keyUp',
    key: 'ArrowUp',
    code: 'ArrowUp',
    windowsVirtualKeyCode: 38,
    nativeVirtualKeyCode: 38,
  })
  await sleep(200)
  const afterBrowsing = await page.evaluate(`(() => ({
    scrollTop: document.querySelector('[data-stage-lyric-scroll]')?.scrollTop ?? -1,
    volume: document.querySelector('[aria-label="音量"]')?.getAttribute('aria-valuenow') ?? '',
    browsing: [...document.querySelectorAll('.stage button')].some(
      (button) => (button.textContent || '').trim() === '回到当前句',
    ),
  }))()`)
  const browsingScroll = await page.evaluate(
    `document.querySelector('[data-stage-lyric-scroll]')?.scrollTop ?? -1`,
  )
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.stage button')]
      .find((button) => (button.textContent || '').trim() === '相关推荐')
    hit?.click()
  })()`)
  await sleep(250)
  const relatedKept = await page.evaluate(`(() => ({
    open: !!document.querySelector('[data-stage-related]'),
    lyricHidden: (document.querySelector('[data-stage-lyric-scroll]')?.clientHeight ?? -1) === 0,
  }))()`)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.stage button')]
      .find((button) => (button.textContent || '').trim() === '相关推荐')
    hit?.click()
  })()`)
  await sleep(250)
  const restoredBrowsing = await page.evaluate(`(() => ({
    scrollTop: document.querySelector('[data-stage-lyric-scroll]')?.scrollTop ?? -1,
    returnVisible: [...document.querySelectorAll('.stage button')].some(
      (button) => (button.textContent || '').trim() === '回到当前句',
    ),
  }))()`)
  check(
    '开关相关推荐后保留歌词浏览位置',
    relatedKept.open &&
      relatedKept.lyricHidden &&
      restoredBrowsing.returnVisible &&
      restoredBrowsing.scrollTop === browsingScroll,
  )
  const currentBefore = await page.evaluate(
    `document.querySelector('button[data-current]')?.textContent?.trim() ?? ''`,
  )
  let pausedForReturn = false
  for (let i = 0; i < 3 && !pausedForReturn; i += 1) {
    pausedForReturn = await page.evaluate(`(() => {
      const play = document.querySelector('.stage button[aria-label="播放"]')
      if (play) return true
      document.querySelector('.stage button[aria-label="暂停"]')?.click()
      return false
    })()`)
    await sleep(200)
  }
  const progressBeforeReturn = await page.evaluate(
    `document.querySelector('[aria-label="播放进度"]')?.getAttribute('aria-valuenow') ?? ''`,
  )
  const returnClicked = await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.stage button')]
      .find((button) => (button.textContent || '').trim() === '回到当前句')
    hit?.click()
    return !!hit
  })()`)
  await sleep(350)
  const following = await page.evaluate(
    `![...document.querySelectorAll('.stage button')].some((button) => (button.textContent || '').trim() === '回到当前句')`,
  )
  const progressAfterReturn = await page.evaluate(
    `document.querySelector('[aria-label="播放进度"]')?.getAttribute('aria-valuenow') ?? ''`,
  )
  const returnFocusInside = await page.evaluate(
    `!!document.querySelector('.stage')?.contains(document.activeElement) && document.activeElement !== document.body`,
  )
  check(
    '滚轮浏览歌词后暂停跟随，回到当前句不跳播',
    afterBrowsing.browsing &&
      afterBrowsing.volume === beforeBrowsing.volume &&
      returnClicked &&
      following &&
      pausedForReturn &&
      progressAfterReturn === progressBeforeReturn &&
      returnFocusInside &&
      currentBefore.length > 0 &&
      (await page.evaluate(
        `document.querySelector('button[data-current]')?.textContent?.trim() === ${JSON.stringify(currentBefore)}`,
      )),
  )

  const seeked = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-stage-lyric-scroll] button')]
    const target = [...rows].reverse().find((row) => row.dataset.current !== 'true')
    if (!target) return null
    const text = target.textContent.trim()
    target.click()
    return text
  })()`)
  let seekedReady = false
  for (let i = 0; i < 20 && !seekedReady; i += 1) {
    await sleep(150)
    seekedReady = await page.evaluate(
      `document.querySelector('button[data-current]')?.textContent?.trim() === ${JSON.stringify(seeked)}`,
    )
  }
  check(
    '点击带时间的歌词会跳播',
    seeked && seekedReady,
  )

  await page.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  )
  await sleep(300)
  const escaped = await page.evaluate(`(() => ({
    stage: !!document.querySelector('.stage'),
    rail: document.querySelector('.rail-slot')?.dataset.open,
    focus: document.activeElement?.getAttribute('aria-label'),
  }))()`)
  check(
    'Esc 只关舞台，保留右栏并把焦点还给舞台入口',
    !escaped.stage &&
      escaped.rail === 'true' &&
      escaped.focus === '打开播放舞台',
  )
  await page.evaluate(`document.querySelector('button[aria-label="打开播放舞台"]')?.click()`)
  await sleep(300)
  await page.viewport(1320, 560)
  await sleep(400)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.stage button')]
      .find((button) => (button.textContent || '').trim() === '相关推荐')
    hit?.click()
  })()`)
  await sleep(250)
  const shortStage = await page.evaluate(`(() => {
    const pane = document.querySelector('.stage-lyrics-pane')?.getBoundingClientRect()
    const pause = document.querySelector('.stage button[aria-label="暂停"], .stage button[aria-label="播放"]')?.getBoundingClientRect()
    const volume = document.querySelector('.stage button[aria-label="静音"], .stage button[aria-label="取消静音"]')?.getBoundingClientRect()
    return pane && pause && volume
      ? {
          paneBottom: pane.bottom,
          pauseTop: pause.top,
          volumeTop: volume.top,
          related: !!document.querySelector('[data-stage-related]'),
        }
      : null
  })()`)
  check(
    '低高度窗口中歌词和相关推荐不压住播放控件',
    shortStage &&
      shortStage.related &&
      shortStage.paneBottom <= shortStage.pauseTop + 1 &&
      shortStage.paneBottom <= shortStage.volumeTop + 1,
  )
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.stage button')]
      .find((button) => (button.textContent || '').trim() === '相关推荐')
    hit?.click()
  })()`)
  await sleep(200)
  await page.viewport(380, 560)
  await sleep(500)
  const narrow = await page.evaluate(`(() => {
    const lyrics = document.querySelector('[data-stage-lyric-scroll]')
    const box = lyrics?.getBoundingClientRect()
    const pause = document.querySelector('.stage button[aria-label="暂停"], .stage button[aria-label="播放"]')
    const pauseBox = pause?.getBoundingClientRect()
    const hit = pauseBox
      ? document.elementFromPoint(pauseBox.left + pauseBox.width / 2, pauseBox.top + pauseBox.height / 2)
      : null
    return {
      width: box?.width ?? 0,
      columns: getComputedStyle(document.querySelector('.stage .grid')).gridTemplateColumns,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      hasVolume: !!document.querySelector('.stage button[aria-label="静音"], .stage button[aria-label="取消静音"]'),
      pauseHit: !!hit?.closest('button') && (hit.closest('button') === pause),
    }
  })()`)
  const narrowBefore = await page.evaluate(`(() => {
    const scroller = document.querySelector('[data-stage-lyric-scroll]')
    if (scroller) scroller.scrollTop = 0
    scroller?.focus()
    return {
      scrollTop: scroller?.scrollTop ?? 0,
      volume: document.querySelector('[aria-label="音量"]')?.getAttribute('aria-valuenow') ?? '',
    }
  })()`)
  await page.keyEvent({
    type: 'keyDown',
    key: 'ArrowDown',
    code: 'ArrowDown',
    windowsVirtualKeyCode: 40,
    nativeVirtualKeyCode: 40,
  })
  await page.keyEvent({
    type: 'keyUp',
    key: 'ArrowDown',
    code: 'ArrowDown',
    windowsVirtualKeyCode: 40,
    nativeVirtualKeyCode: 40,
  })
  await sleep(200)
  const narrowAfter = await page.evaluate(`(() => ({
    scrollTop: document.querySelector('[data-stage-lyric-scroll]')?.scrollTop ?? 0,
    volume: document.querySelector('[aria-label="音量"]')?.getAttribute('aria-valuenow') ?? '',
  }))()`)
  check(
    '窄窗舞台按上下布局保留歌词和播放控件',
    narrow.width >= 300 &&
      narrow.columns.trim().split(/\s+/).length === 1 &&
      !narrow.overflow &&
      narrow.hasVolume &&
      narrow.pauseHit &&
      narrowAfter.scrollTop !== narrowBefore.scrollTop &&
      narrowAfter.volume === narrowBefore.volume,
  )
  const autoBefore = await page.evaluate(
    `document.querySelector('[data-stage-lyric-scroll]')?.scrollTop ?? 0`,
  )
  const lastText = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-stage-lyric-scroll] button')]
    const last = rows.at(-1)
    if (!last) return null
    const text = last.textContent.trim()
    last.click()
    return text
  })()`)
  let autoFollowed = false
  for (let i = 0; i < 20 && !autoFollowed; i += 1) {
    await sleep(120)
    autoFollowed = await page.evaluate(`(() => {
      const scroller = document.querySelector('[data-stage-lyric-scroll]')
      return document.querySelector('button[data-current]')?.textContent?.trim() === ${JSON.stringify(lastText)} &&
        (scroller?.scrollTop ?? 0) > ${autoBefore}
    })()`)
  }
  check('当前句变化会自动滚到歌词视口', Boolean(lastText) && autoFollowed)
  await page.viewport(1320, 900)
  await page.evaluate(`document.querySelector('button[aria-label="退出舞台"]')?.click()`)
  await sleep(200)
  await page.emulateMedia([])
}

async function checkStageMorph(page) {
  const waitFor = async (expression, timeout = 3000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(100)
    }
    return false
  }
  const read = () =>
    page.evaluate(`(() => {
      const stage = document.querySelector('.stage')
      const vinyl = document.querySelector('[data-stage-cover]')
      const cover = vinyl?.querySelector('img')
      const flyer = document.querySelector('[data-stage-flyer]')
      const origin = document.querySelector('[data-stage-origin]')
      const originImage = origin?.querySelector('img')
      const bar = origin?.closest('section')
      const progress = bar?.querySelector('[aria-label="播放进度"]')
      const play = bar?.querySelector('button[aria-label="暂停"], button[aria-label="播放"]')
      const originRect = origin?.getBoundingClientRect()
      const hit = originRect
        ? document.elementFromPoint(
            originRect.left + originRect.width / 2,
            originRect.top + originRect.height / 2,
          )
        : null
      const coverVisible =
        !!cover &&
        getComputedStyle(cover).visibility !== 'hidden' &&
        cover.getClientRects().length > 0
      const coverBox = cover?.getBoundingClientRect()
      const originVisible =
        !!originImage &&
        getComputedStyle(originImage).visibility !== 'hidden' &&
        originImage.getClientRects().length > 0
      return {
        visibility: document.visibilityState,
        stage: !!stage,
        stageOpacity: stage ? Number(getComputedStyle(stage).opacity) : 0,
        flyer: !!flyer,
        flyerPointerEvents: flyer ? getComputedStyle(flyer).pointerEvents : '',
        coverVisible,
        // 中心与未旋转的尺寸：唱片一直在转，直接比包围盒会随角度变胖。
        coverRect: cover && coverBox
          ? [coverBox.left + coverBox.width / 2, coverBox.top + coverBox.height / 2, cover.offsetWidth, cover.offsetHeight]
          : null,
        fallback: !!stage?.querySelector('[data-stage-cover] img[data-cover-fallback]'),
        originVisible,
        originConnected: !!origin,
        originHittable: !!hit?.closest('[data-stage-origin]'),
        progress: progress ? Number(progress.getAttribute('aria-valuenow')) : -1,
        phase: play?.getAttribute('aria-label') ?? '',
        focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? '',
        stageTitle: stage?.querySelector('h2')?.textContent?.trim() ?? '',
        barTitle: bar?.querySelector('.bili-marquee')?.textContent?.trim() ?? '',
      }
    })()`)

  /**
   * 点开后逐帧记录飞图与舞台封面的矩形，直到飞图消失。
   * CDP 往返要几十毫秒，错过末帧就量不到落点，所以取样放在页面里做。
   */
  const openAndSample = () =>
    page.evaluate(`new Promise((resolve) => {
      const origin = document.querySelector('[data-stage-origin]')
      if (!origin) {
        resolve(null)
        return
      }
      const samples = []
      let coverHidden = false
      const started = performance.now()
      let done = false
      const finish = () => {
        if (done) return
        done = true
        const cover = document.querySelector('[data-stage-cover] img')
        resolve({
          flyer: samples.length > 0,
          stage: !!document.querySelector('.stage'),
          coverHidden,
          settledHidden: !!cover && getComputedStyle(cover).visibility === 'hidden',
          samples,
        })
      }
      const tick = () => {
        if (done) return
        const flyer = document.querySelector('[data-stage-flyer]')
        const target = document.querySelector('[data-stage-cover] img')
        if (flyer && target) {
          const box = flyer.getBoundingClientRect()
          const goal = target.getBoundingClientRect()
          if (samples.length === 0) coverHidden = getComputedStyle(target).visibility === 'hidden'
          samples.push({
            at: Math.round(performance.now() - started),
            flyer: [
              box.left + box.width / 2,
              box.top + box.height / 2,
              flyer.offsetWidth,
              flyer.offsetHeight,
            ],
            target: [
              goal.left + goal.width / 2,
              goal.top + goal.height / 2,
              target.offsetWidth,
              target.offsetHeight,
            ],
          })
        }
        if (samples.length > 0 && !document.querySelector('[data-stage-flyer]')) {
          finish()
          return
        }
        // 没有飞图（缺封面、入口不可见、减少动态效果）等不到消失事件。
        if (samples.length === 0 && performance.now() - started > 800) {
          finish()
          return
        }
        if (performance.now() - started > 4000) {
          finish()
          return
        }
        requestAnimationFrame(tick)
      }
      origin.click()
      requestAnimationFrame(tick)
    })`)

  const closeAndSample = () =>
    page.evaluate(`new Promise((resolve) => {
      const exit = document.querySelector('button[aria-label="退出舞台"]')
      if (!exit) {
        resolve(null)
        return
      }
      let flyerSeen = false
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-stage-flyer]')) flyerSeen = true
      })
      observer.observe(document.body, { childList: true, subtree: true })
      exit.click()
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        observer.disconnect()
        const originImage = document.querySelector('[data-stage-origin] img')
        resolve({
          flyer: flyerSeen || !!document.querySelector('[data-stage-flyer]'),
          originHidden: !!originImage && getComputedStyle(originImage).visibility === 'hidden',
          stage: !!document.querySelector('.stage'),
        })
      }
      requestAnimationFrame(finish)
      setTimeout(finish, 1500)
    })`)

  const openThenEscape = () =>
    page.evaluate(`new Promise((resolve) => {
      const origin = document.querySelector('[data-stage-origin]')
      if (!origin) {
        resolve(null)
        return
      }
      origin.click()
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        const flyerBeforeEscape = !!document.querySelector('[data-stage-flyer]')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        resolve({ flyerBeforeEscape })
      }
      requestAnimationFrame(finish)
      setTimeout(finish, 1500)
    })`)

  const openThenExitClick = () =>
    page.evaluate(`new Promise((resolve) => {
      const origin = document.querySelector('[data-stage-origin]')
      if (!origin) {
        resolve(null)
        return
      }
      origin.click()
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        const flyerBeforeExit = !!document.querySelector('[data-stage-flyer]')
        document.querySelector('button[aria-label="退出舞台"]')?.click()
        resolve({ flyerBeforeExit })
      }
      requestAnimationFrame(finish)
      setTimeout(finish, 1500)
    })`)

  const pressEscape = async () => {
    await page.keyEvent({
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await page.keyEvent({
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
  }

  /** 两组 [中心 x, 中心 y, 宽, 高] 的差。 */
  const landingGap = (sample) => {
    const [flyerX, flyerY, flyerWidth, flyerHeight] = sample.flyer
    const [targetX, targetY, targetWidth, targetHeight] = sample.target
    return {
      dx: Math.abs(flyerX - targetX),
      dy: Math.abs(flyerY - targetY),
      dw: Math.abs(flyerWidth - targetWidth),
      dh: Math.abs(flyerHeight - targetHeight),
    }
  }
  const aligned = (sample) => {
    if (!sample) return false
    const gap = landingGap(sample)
    return Math.max(gap.dx, gap.dy, gap.dw, gap.dh) <= 2
  }
  const sameRect = (a, b) =>
    !!a &&
    !!b &&
    Math.max(
      Math.abs(a[0] - b[0]),
      Math.abs(a[1] - b[1]),
      Math.abs(a[2] - b[2]),
      Math.abs(a[3] - b[3]),
    ) <= 2
  const centerY = (sample) => sample.target[1]

  const loadAndListen = async (search = '') => {
    const url = new URL(WEB)
    if (search) url.search = search
    await page.viewport(1320, 900)
    await page.evaluate(`location.href = ${JSON.stringify(url.href)}`)
    await sleep(5500)
    const clicked = await page.evaluate(`(() => {
      const hit = document.querySelector('button[aria-label^="听 "]')
      hit?.click()
      return !!hit
    })()`)
    const barReady = await waitFor(`(() => {
      const origin = document.querySelector('[data-stage-origin]')
      const image = origin?.querySelector('img')
      return !!origin && !!image && image.complete && image.naturalWidth > 0
    })()`, 8000)
    return clicked && barReady
  }

  const baseReady = await loadAndListen()
  const playingReady = await waitFor(`(() => {
    const bar = document.querySelector('[data-stage-origin]')?.closest('section')
    return !!bar?.querySelector('button[aria-label="暂停"]')
  })()`, 4000)
  const before = await read()
  const opening = await openAndSample()
  await waitFor(`!!document.querySelector('.stage') && !document.querySelector('[data-stage-flyer]')`, 3000)
  const settled = await read()
  const closing = await closeAndSample()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  const closed = await read()
  const landing = opening?.samples?.at(-1) ?? null

  check(
    '播放中从播放条展开时封面飞向舞台封面',
    baseReady &&
      playingReady &&
      opening &&
      opening.stage &&
      opening.flyer &&
      opening.coverHidden &&
      settled.flyerPointerEvents !== 'auto',
  )
  check('飞图末帧与舞台封面中心、尺寸对齐（≤2px）', aligned(landing))
  if (!aligned(landing)) console.log(JSON.stringify({ landing, gap: landing && landingGap(landing) }))
  check(
    '舞台稳定后只剩一张前景封面，焦点落在舞台',
    settled.stage &&
      settled.stageOpacity === 1 &&
      settled.coverVisible &&
      !settled.flyer &&
      aligned(landing) &&
      sameRect(landing.target, settled.coverRect) &&
      settled.focus === '退出舞台',
  )
  check(
    '收起时封面回到播放条，播放进度继续',
    closing &&
      closing.stage &&
      closing.flyer &&
      closing.originHidden &&
      !closed.stage &&
      !closed.flyer &&
      closed.originVisible &&
      closed.phase === '暂停' &&
      closed.progress > before.progress &&
      closed.focus === '打开播放舞台' &&
      closed.originHittable,
  )
  if (
    closed.stage ||
    !closing ||
    !closed.originVisible ||
    closed.phase !== '暂停' ||
    !(closed.progress > before.progress) ||
    closed.focus !== '打开播放舞台' ||
    !closed.originHittable
  ) {
    console.log(JSON.stringify({ before, closing, closed }))
  }

  await page.evaluate(`(() => {
    const bar = document.querySelector('[data-stage-origin]')?.closest('section')
    bar?.querySelector('button[aria-label="暂停"]')?.click()
  })()`)
  await sleep(300)
  const pausedBefore = await read()
  const originFocused = await page.evaluate(`(() => {
    const origin = document.querySelector('[data-stage-origin]')
    origin?.focus()
    return document.activeElement === origin
  })()`)
  await page.pressSpace()
  const keyboardStage = await waitFor(`!!document.querySelector('.stage')`)
  await waitFor(`!!document.querySelector('.stage') && !document.querySelector('[data-stage-flyer]')`, 3000)
  const keyboardSettled = await read()
  await pressEscape()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  const pausedAfter = await read()
  check(
    '暂停时用键盘开合舞台仍保持暂停',
    originFocused &&
      keyboardStage &&
      keyboardSettled.stage &&
      keyboardSettled.phase === '播放' &&
      !pausedAfter.stage &&
      pausedAfter.phase === '播放' &&
      Math.abs(pausedAfter.progress - pausedBefore.progress) <= 1,
  )

  await page.viewport(380, 720)
  await sleep(400)
  const narrowOpening = await openAndSample()
  await waitFor(`!!document.querySelector('.stage') && !document.querySelector('[data-stage-flyer]')`, 3000)
  const narrowSettled = await read()
  await pressEscape()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  const narrowClosed = await read()
  await page.viewport(1320, 900)
  await sleep(400)
  check(
    '窄窗展开和收起也共用同一张封面',
    narrowOpening &&
      narrowOpening.stage &&
      narrowOpening.flyer &&
      narrowSettled.stage &&
      !narrowSettled.flyer &&
      narrowSettled.coverVisible &&
      !narrowClosed.stage &&
      narrowClosed.originHittable,
  )

  // 详情和推荐晚于首帧到达时，左栏会被撑高、唱片上移；飞图必须跟着走。
  const slowReady = await loadAndListen('?slowStage=1')
  const slowOpening = await openAndSample()
  await waitFor(`!!document.querySelector('.stage') && !document.querySelector('[data-stage-flyer]')`, 3000)
  const slowSettled = await read()
  const slowShift = slowOpening?.samples.length
    ? Math.max(...slowOpening.samples.map((sample) => Math.abs(centerY(sample) - centerY(slowOpening.samples[0]))))
    : 0
  check(
    `详情晚到时封面跟着唱片上移，落点仍对齐（位移 ${Math.round(slowShift)}px）`,
    slowReady &&
      slowOpening &&
      slowOpening.flyer &&
      slowShift >= 10 &&
      aligned(slowOpening.samples.at(-1)) &&
      slowSettled.stage &&
      !slowSettled.flyer &&
      slowSettled.coverVisible &&
      sameRect(slowOpening.samples.at(-1).target, slowSettled.coverRect),
  )
  if (!aligned(slowOpening?.samples.at(-1))) {
    console.log(JSON.stringify({ shift: slowShift, landing: slowOpening?.samples.at(-1) }))
  }
  await pressEscape()
  await waitFor(`!document.querySelector('.stage')`, 3000)

  const escDuringOpen = await openThenEscape()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  const afterEsc = await read()
  check(
    '展开动画中按 Esc 按最新意图收起',
    escDuringOpen &&
      escDuringOpen.flyerBeforeEscape &&
      !afterEsc.stage &&
      !afterEsc.flyer &&
      afterEsc.originVisible &&
      afterEsc.focus === '打开播放舞台' &&
      afterEsc.originHittable,
  )

  const exitDuringOpen = await openThenExitClick()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  const afterExit = await read()
  check(
    '展开动画中点退出按钮同样收起',
    exitDuringOpen &&
      exitDuringOpen.flyerBeforeExit &&
      !afterExit.stage &&
      !afterExit.flyer &&
      afterExit.originHittable,
  )

  let cycles = true
  for (let i = 0; i < 3; i += 1) {
    const cycleOpen = await openThenEscape()
    await waitFor(`!document.querySelector('.stage')`, 3000)
    const cycleState = await read()
    cycles = cycles && !!cycleOpen?.flyerBeforeEscape && !cycleState.stage && !cycleState.flyer
  }
  const afterCycles = await read()
  check(
    '连续快速开合后没有旧图或透明层残留',
    cycles && !afterCycles.stage && afterCycles.originVisible && afterCycles.originHittable,
  )

  await openAndSample()
  await sleep(40)
  await page.viewport(1100, 800)
  await waitFor(`!!document.querySelector('.stage') && !document.querySelector('[data-stage-flyer]')`, 3000)
  const resized = await read()
  check(
    '展开途中缩放窗口直接落到舞台封面',
    resized.stage && !resized.flyer && resized.coverVisible,
  )
  await pressEscape()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  await page.viewport(1320, 900)
  await sleep(200)
  const afterResize = await read()
  check('缩放后收起仍回到可操作的播放条', !afterResize.stage && afterResize.originHittable)
  if (afterResize.stage || !afterResize.originHittable) {
    console.log(JSON.stringify({ resized, afterResize }))
  }

  const beforeTrack = await read()
  await openAndSample()
  await sleep(30)
  const changed = await page.evaluate(`(() => {
    const next = document.querySelector('.stage button[aria-label="下一首"]')
    next?.click()
    return !!next
  })()`)
  await waitFor(`(() => {
    const stage = document.querySelector('.stage')
    const bar = document.querySelector('[data-stage-origin]')?.closest('section')
    return !!stage &&
      !document.querySelector('[data-stage-flyer]') &&
      stage.querySelector('h2')?.textContent?.trim() === bar?.querySelector('.bili-marquee')?.textContent?.trim()
  })()`, 3000)
  const afterTrack = await read()
  check(
    '展开途中切歌直接落到新封面',
    changed &&
      afterTrack.stage &&
      !afterTrack.flyer &&
      afterTrack.coverVisible &&
      afterTrack.stageTitle.length > 0 &&
      afterTrack.stageTitle === afterTrack.barTitle &&
      afterTrack.stageTitle !== beforeTrack.stageTitle,
  )
  if (
    !changed ||
    !afterTrack.stage ||
    afterTrack.flyer ||
    !afterTrack.coverVisible ||
    afterTrack.stageTitle !== afterTrack.barTitle ||
    afterTrack.stageTitle === beforeTrack.stageTitle
  ) {
    console.log(JSON.stringify({ beforeTrack, afterTrack, changed }))
  }
  await pressEscape()
  await waitFor(`!document.querySelector('.stage')`, 3000)

  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  const reducedOpen = await openAndSample()
  await waitFor(`!!document.querySelector('.stage')`, 2000)
  const reduced = await read()
  await pressEscape()
  await waitFor(`!document.querySelector('.stage')`, 2000)
  const reducedClosed = await read()
  await page.emulateMedia([])
  check(
    '减少动态效果时直接落位',
    reducedOpen &&
      reducedOpen.stage &&
      !reducedOpen.flyer &&
      reduced.stage &&
      reduced.stageOpacity === 1 &&
      reduced.coverVisible &&
      !reduced.flyer &&
      !reducedClosed.stage &&
      !reducedClosed.flyer,
  )

  const noCoverReady = await loadAndListen('?stageNoCover=1')
  const noCoverOpening = await openAndSample()
  await waitFor(`!!document.querySelector('.stage') && Number(getComputedStyle(document.querySelector('.stage')).opacity) === 1`, 3000)
  const noCoverSettled = await read()
  await closeAndSample()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  const noCoverClosed = await read()
  check(
    '缺封面时展开和收起都不出现飞图',
    noCoverReady &&
      noCoverOpening &&
      noCoverOpening.stage &&
      !noCoverOpening.flyer &&
      noCoverSettled.stage &&
      noCoverSettled.fallback &&
      !noCoverSettled.flyer &&
      !noCoverClosed.stage &&
      !noCoverClosed.flyer,
  )

  const visibleReady = await loadAndListen()
  const hiddenOrigin = await page.evaluate(`(() => {
    const origin = document.querySelector('[data-stage-origin]')
    if (!origin) return false
    origin.style.visibility = 'hidden'
    return true
  })()`)
  const hiddenOpening = await openAndSample()
  await waitFor(`!!document.querySelector('.stage') && !document.querySelector('[data-stage-flyer]') && Number(getComputedStyle(document.querySelector('.stage')).opacity) === 1`, 3000)
  const hiddenSettled = await read()
  await page.evaluate(`(() => {
    const origin = document.querySelector('[data-stage-origin]')
    if (origin) origin.style.visibility = ''
  })()`)
  await pressEscape()
  await waitFor(`!document.querySelector('.stage')`, 3000)
  const hiddenClosed = await read()
  check(
    '入口不可见时不出现飞图，收起后入口恢复操作',
    visibleReady &&
      hiddenOrigin &&
      hiddenOpening.stage &&
      !hiddenOpening.flyer &&
      hiddenSettled.stage &&
      !hiddenSettled.flyer &&
      !hiddenClosed.stage &&
      hiddenClosed.originHittable,
  )
  if (hiddenOpening.flyer || hiddenSettled.flyer || hiddenClosed.stage || !hiddenClosed.originHittable) {
    console.log(JSON.stringify({ hiddenOpening, hiddenSettled, hiddenClosed }))
  }
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
      `document.querySelectorAll('[data-home-hero-grid] [data-focus-id^="herocard:"]').length === 6 &&
       document.querySelectorAll('[data-home-feed] [data-track-card]').length >= 5`,
    )
  }
  const read = () =>
    page.evaluate(`(() => {
      const carousel = [...document.querySelectorAll('[aria-label="推荐轮播"] img[data-track-title]')]
        .map((image) => image.dataset.trackTitle ?? '')
      const grid = [...document.querySelectorAll('[data-home-hero-grid] [data-focus-id^="herocard:"]')]
        .map((card) => card.querySelector('.line-clamp-2')?.textContent?.trim() ?? '')
      const feed = [...document.querySelectorAll('[data-home-feed] [data-track-card]')]
        .map((card) => card.dataset.trackTitle ?? '')
      return { carousel, grid, feed }
    })()`)
  const wide = await read()
  await page.viewport(1023, 900)
  await sleep(500)
  const narrow = await read()
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
      placedOnce(initialTitles, [...narrow.carousel, ...narrow.grid, ...narrow.feed]) &&
      narrow.grid.length === 2 &&
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
      `[...document.querySelectorAll('[data-home-hero-grid] [data-focus-id^="herocard:"]')].some((card) =>
        card.textContent.includes('首页分配 12'))`,
    )
  }
  const refreshed = await read()
  await page.viewport(1023, 900)
  await sleep(500)
  const refreshedNarrow = await read()
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
      refreshedNarrow.grid.length === 2 &&
      refreshedOnce([...refreshedNarrow.carousel, ...refreshedNarrow.grid, ...refreshedNarrow.feed]),
  )
  if (
    !refreshedOnce([...refreshed.carousel, ...refreshed.grid, ...refreshed.feed]) ||
    !refreshedOnce([...refreshedNarrow.carousel, ...refreshedNarrow.grid, ...refreshedNarrow.feed])
  ) {
    console.log(JSON.stringify({ refreshed, refreshedNarrow, refreshedTitles }))
  }
  await page.viewport(1320, 900)
}

async function checkHistoryParts(page) {
  const url = new URL(WEB)
  url.searchParams.set('historyLong', '1')
  url.searchParams.set('manyPages', '1')
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(url)}`)
  const waitFor = watchUiWait(page)
  const watch = "document.querySelector('[data-home-hero-grid] button[data-focus-id^=herocard]')"
  await waitFor(`location.search.includes('historyLong') && ${watch}`)
  await page.evaluate(`(() => {
    for (const [key, page] of [['history-0', 2], ['history-1', 3]]) {
      localStorage.setItem('oh-bilibili:watch-page:' + key, String(page))
      localStorage.setItem('oh-bilibili:watch-pos:' + key + ':' + page, '8000')
      localStorage.setItem('oh-bilibili:watch-len:' + key + ':' + page, '31000')
    }
    ${watch}.click()
  })()`)
  const watched = await waitFor(`!!document.querySelector('video')`)
  await page.evaluate(`document.querySelector('button[title="历史"]')?.click()`)
  await waitFor(`!!document.querySelector('[data-history-row]')`)
  for (const [key, position, action, label] of [
    ['history-0', 8000, '继续播放', '旧记录按本地 P2 和时间续听'],
    ['history-1', 12000, '继续播放', '新历史用已存 P2 断点并保留当天队列'],
    ['history-2', 0, '从头播放', '已播完的 P2 从本集开头重播'],
  ]) {
    const source = `document.querySelector('[data-history-row][data-key="${key}"]')`
    const row = await page.evaluate(`(() => {
      const row = ${source}
      const button = row?.querySelector('[data-history-play]')
      const keys = [...row?.closest('section').querySelectorAll('[data-history-row]') ?? []].map((r) => r.dataset.key)
      const page = [...row?.querySelectorAll('span') ?? []].some((s) => s.textContent === 'P2')
      const action = button?.getAttribute('aria-label')
      button?.click()
      return { keys, page, action }
    })()`)
    const selected = await waitFor(`${source}?.getAttribute('aria-current') === 'true' && !!document.querySelector('[aria-label="打开播放舞台"]')`)
    const [state, queue] = await page.evaluate(`(async () => {
      const module = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/shared/lib/ipc.ts')
      const ipc = await import(module.name)
      return Promise.all([ipc.playerState(), ipc.queueState()])
    })()`)
    check(label, watched && selected && row.page && row.action?.startsWith(action) && state.mode === 'listen' &&
      state.track?.key === key && state.page?.no === 2 && state.duration_ms === 31000 &&
      state.position_ms >= position && state.position_ms < position + 2000 &&
      JSON.stringify(queue.items.map((item) => item.key)) === JSON.stringify(row.keys) && row.keys[queue.index] === key)
  }
  await page.evaluate(`(() => {
    for (const key of Object.keys(localStorage)) {
      if (/watch-(page|pos|len):history-[01](:|$)/.test(key)) localStorage.removeItem(key)
    }
  })()`)
}

async function checkDiscoveryFeed(page) {
  const waitFor = watchUiWait(page)
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB + '?historyLong=1')}`)
  await waitFor("document.querySelector('[data-home-recommend]')")
  await page.clickExactText('历史')
  await waitFor("document.querySelector('[data-history-row] [data-history-play]')")
  check('有可续播的记录时仍能从历史找回', await page.evaluate(
    `[...document.querySelectorAll('[data-history-play]')].some((button) => button.getAttribute('aria-label')?.startsWith('继续播放'))`,
  ))
  await page.clickExactText('发现')
  await waitFor("document.querySelector('[data-home-recommend]')")
  const feedOnly = `(() => {
    const home = document.getElementById('scroll-main')
    const tab = home?.querySelector('[aria-label="发现分区"] [aria-pressed="true"]')
    return tab?.textContent.trim() === '全部' &&
      !!home.querySelector('[aria-label="推荐轮播"] [data-track-title]') &&
      !!home.querySelector('[data-home-hero-grid] [data-focus-id^="herocard:"]') &&
      !home.querySelector('[data-home-resume], [data-home-region], .discovery-shelf') &&
      ![...home.querySelectorAll('h2')].some((heading) =>
        ['正在直播', '番剧', '动画', '音乐', '游戏'].includes(heading.textContent.trim()))
  })()`
  check('宽窗全部直接显示推荐投稿，没有续播和分区楼层', await page.evaluate(feedOnly))
  await page.viewport(390, 820)
  check('窄窗全部同样只显示推荐投稿', await page.evaluate(feedOnly))
  await checkDiscoveryEditor(page)
  await page.evaluate(`location.href = ${JSON.stringify(WEB + '?failHome=1')}`)
  await waitFor("document.body.innerText.includes('连不上 B 站')")
  check('推荐失败时提示重试，不用历史或分区内容填充', await page.evaluate(`(() => {
    const home = document.getElementById('scroll-main')
    return [...home.querySelectorAll('button')].some((button) => button.textContent.trim() === '重新取一次') &&
      !home.querySelector('[data-home-recommend], [data-home-resume], [data-track-card], .discovery-shelf')
  })()`))
}

const discoveryNav = 'nav[aria-label="发现分区"]'
const discoveryDirectory = '[role="dialog"][aria-label="全部分区"]'
const discoveryEditor = '[role="dialog"][aria-label="编辑常用"]'

async function clickDiscoveryButton(page, container, name) {
  const button = `[...document.querySelectorAll(${JSON.stringify(container + ' button')})]
    .find((item) => (item.getAttribute('aria-label') || item.textContent.trim()) === ${JSON.stringify(name)}
      && item.getClientRects().length)`
  await watchUiWait(page)(button)
  await page.evaluate(`${button}.click()`)
}

async function openDiscoveryEditor(page) {
  await clickDiscoveryButton(page, discoveryNav, '全部分区')
  await clickDiscoveryButton(page, discoveryDirectory, '编辑常用')
}

async function checkDiscoveryEditor(page) {
  const waitFor = watchUiWait(page)
  const edit = (name) => clickDiscoveryButton(page, discoveryEditor, name)
  const pinned = () => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(discoveryEditor + ' button[aria-label^="移除"]')})]
    .map((button) => button.getAttribute('aria-label').slice(2))`)
  await page.viewport(1320, 900)
  await openDiscoveryEditor(page)
  await edit('恢复默认')
  const defaults = await pinned()
  await edit('保存')

  const legacy = [
    { kind: 'region', rid: 1004, label: '跳舞' },
    { kind: 'keyword', keyword: '动画短片', label: '短片收藏' },
    { kind: 'region', rid: 999999, label: '过期分区' },
    { kind: 'region', rid: 1003, label: '音乐' },
  ]
  await page.evaluate(`localStorage.setItem('bili.discovery.tabs', ${JSON.stringify(JSON.stringify(legacy))}); location.reload()`)
  await waitFor("document.querySelector('[data-home-recommend]')")
  await openDiscoveryEditor(page)
  check('升级时保留常用顺序，恢复官方名称，清理关键词和失效分区',
    JSON.stringify(await pinned()) === JSON.stringify(['舞蹈', '音乐']) &&
    await page.evaluate(`!document.querySelector(${JSON.stringify(discoveryEditor)}).querySelector('input')`))
  await edit('前移音乐')
  const moved = await pinned()
  await edit('移除舞蹈')
  await edit('添加鬼畜')
  await edit('保存')
  await page.evaluate('location.reload()')
  await waitFor("document.querySelector('[data-home-recommend]')")
  await openDiscoveryEditor(page)
  check('添加、移除、移动常用分区均可保存，重开顺序正确',
    JSON.stringify(moved) === JSON.stringify(['音乐', '舞蹈']) &&
    JSON.stringify(await pinned()) === JSON.stringify(['音乐', '鬼畜']))
  await edit('取消')

  for (const width of [1320, 390]) {
    await clickDiscoveryButton(page, discoveryNav, '全部')
    await waitFor("document.querySelector('[data-home-recommend]')")
    await page.viewport(width, 820)
    await page.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))')
    await clickDiscoveryButton(page, discoveryNav, '全部分区')
    const layout = await page.evaluate(`(() => {
      const panel = document.querySelector(${JSON.stringify(discoveryDirectory)})
      const box = panel.getBoundingClientRect()
      const buttons = [...panel.querySelectorAll('button[aria-pressed]')].filter((button) => button.getClientRects().length)
      const names = buttons.map((button) => button.textContent.trim())
      return names.length === 31 && new Set(names).size === names.length && names.slice(0, 2).join() === '音乐,鬼畜' &&
        box.left >= 0 && box.right <= innerWidth + 1 && buttons.every((button) => {
          const rect = button.getBoundingClientRect()
          return rect.left >= box.left - 1 && rect.right <= box.right + 1
        }) && document.documentElement.scrollWidth <= innerWidth
    })()`)
    await clickDiscoveryButton(page, discoveryDirectory, '人工智能')
    await waitFor("document.querySelector('[data-home-region] [data-track-card]')?.innerText.includes('· 人工智能')")
    const active = await page.evaluate(`(() => {
      const nav = document.querySelector(${JSON.stringify(discoveryNav)})
      const current = [...nav.querySelectorAll('[aria-pressed="true"]')].filter((button) => button.getClientRects().length)
      const rect = current[0]?.getBoundingClientRect()
      return current.length === 1 && current[0].textContent.trim() === '人工智能' &&
        [rect.left + 2, rect.right - 2].every((x) => current[0].contains(document.elementFromPoint(x, rect.top + rect.height / 2))) &&
        !document.querySelector('[data-home-recommend], [role="dialog"]')
    })()`)
    check(`${width}px 目录可直接选未固定的官方分区，当前项看得见，无需横拖`, layout && active)
  }

  await openDiscoveryEditor(page)
  await edit('全部移除')
  await edit('保存')
  await clickDiscoveryButton(page, discoveryNav, '全部')
  await clickDiscoveryButton(page, discoveryNav, '全部分区')
  await clickDiscoveryButton(page, discoveryDirectory, '舞蹈')
  await waitFor("document.querySelector('[data-home-region] [data-track-card]')?.innerText.includes('· 舞蹈')")
  await openDiscoveryEditor(page)
  check('常用分区留空后仍能浏览官方分区，浏览不会自动固定', (await pinned()).length === 0)
  await edit('恢复默认')
  await edit('保存')
  await page.evaluate('location.reload()')
  await waitFor("document.querySelector('[data-home-recommend]')")
  await openDiscoveryEditor(page)
  check('恢复默认并重开后，常用分区与原顺序一致',
    defaults.length === 6 && JSON.stringify(await pinned()) === JSON.stringify(defaults))
  await edit('取消')
  check('关闭编辑器后键盘焦点回到全部分区',
    await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(discoveryNav + ' [aria-haspopup="dialog"]')})`))
}

async function checkSidebarMotion(page) {
  const sample = (reverseAt = null) => page.evaluate(`(async () => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const main = document.getElementById('main-content')
    const toggle = nav.querySelector('button[aria-expanded]')
    const profile = Array.from(nav.querySelectorAll('button')).find(button =>
      (button.getAttribute('aria-label') || button.textContent.trim()) === '个人中心')
    const read = () => ({
      edge: nav.getBoundingClientRect().right,
      content: Math.round(main.getBoundingClientRect().left),
      width: Math.round(main.getBoundingClientRect().width),
      row: Math.round(profile.getBoundingClientRect().top),
    })
    const frames = [read()]
    toggle.click()
    const start = performance.now()
    let turned = false
    do {
      await new Promise(requestAnimationFrame)
      const frame = read()
      frames.push(frame)
      if (${reverseAt} !== null && !turned && frame.edge <= ${reverseAt}) {
        toggle.click()
        turned = true
      }
    } while (performance.now() - start < 600)
    return { frames, turned, expanded: toggle.getAttribute('aria-expanded') }
  })()`)
  const close = await sample()
  const open = await sample()
  for (const [name, run] of [['收起', close], ['展开', open]]) {
    const { frames } = run
    const first = frames[0].edge
    const last = frames.at(-1).edge
    const moving = frames.filter(f => f.edge > Math.min(first, last) && f.edge < Math.max(first, last))
    const towardEnd = frames.every((f, i) => !i || (f.edge - frames[i - 1].edge) * Math.sign(last - first) >= 0)
    check(`侧栏${name}经过中间位置，正文边缘始终与它相接`,
      new Set(moving.map(f => f.edge)).size > 1 && towardEnd &&
      (name === '收起' ? last < first : last > first) &&
      frames.every(f => Math.abs(f.edge - f.content) <= 1))
  }
  check('开合时「我的」分组下的导航按钮留在原高度', [...close.frames, ...open.frames].every(frame =>
    Math.abs(frame.row - close.frames[0].row) <= 1))
  const reversed = await sample((close.frames[0].edge + close.frames.at(-1).edge) / 2)
  check('收起途中再点一次，侧栏从中途折返到展开位置', reversed.turned && reversed.expanded === 'true' &&
    Math.min(...reversed.frames.map(f => f.edge)) > close.frames.at(-1).edge &&
    reversed.frames.at(-1).edge === open.frames.at(-1).edge)
  const expanded = open.frames.at(-1)
  const sidebarSettled = 1 + reversed.frames.findLastIndex(f => f.edge !== expanded.edge)
  const contentSettled = 1 + reversed.frames.findLastIndex(f => Math.abs(f.width - expanded.width) > 1)
  check('折返后正文最晚在侧栏停下的下一帧恢复宽度',
    reversed.turned && sidebarSettled < reversed.frames.length && contentSettled < reversed.frames.length &&
    contentSettled <= sidebarSettled + 1)

  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  try {
    const nav = `document.querySelector('nav[aria-label="主导航"]')`
    await page.evaluate(`${nav}.querySelector('[aria-label="展开侧边栏"]')?.click()`)
    const reduced = await sample()
    check('减少动态效果时直接收起侧栏', reduced.expanded === 'false' &&
      reduced.frames.at(-1).edge === close.frames.at(-1).edge &&
      reduced.frames.every(f => f.edge === close.frames[0].edge || f.edge === close.frames.at(-1).edge))
    await page.evaluate(`${nav}.querySelector('[aria-label="展开侧边栏"]').click()`)
  } finally {
    await page.emulateMedia([])
  }
}

/** 导航约定：歌单详情仍在曲库下，观看页返回把焦点还给进来的那张卡。 */
async function checkNavConventions(page) {
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(4000)
  await checkSidebarMotion(page)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('nav[aria-label="主导航"] button')]
      .find((button) => (button.textContent || '').trim() === '曲库')
    hit?.click()
  })()`)
  await sleep(1200)
  await page.evaluate(`(() => {
    const title = document.querySelector('#scroll-main button [title="深夜循环"]')
    title?.closest('button')?.click()
  })()`)
  await sleep(1000)
  const playlistNav = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('nav[aria-label="主导航"] button')]
      .find((item) => (item.textContent || '').trim() === '曲库')
    return {
      current: button?.getAttribute('aria-current') ?? null,
      // 详情页独有的标题，别用歌单名——曲库里本来就有这张卡。
      inPlaylist: (document.querySelector('h1')?.textContent || '').includes('深夜循环'),
    }
  })()`)
  check('歌单详情里左栏仍停在曲库', playlistNav.current === 'page' && playlistNav.inPlaylist)

  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(4000)
  const opened = await page.evaluate(`(async () => {
    const card = document.querySelector('[data-track-card]')
    const button = card?.querySelector('button[aria-label^="观看"]')
    if (!button) return null
    button.click()
    const deadline = performance.now() + 8000
    do {
      await new Promise(requestAnimationFrame)
      const like = document.querySelector('.bili-tri-btn[aria-label="点赞"]')
      if (like?.getClientRects().length) return { key: card.dataset.key, likeX: like.getBoundingClientRect().x }
    } while (performance.now() < deadline)
    return null
  })()`)
  let watching = false
  for (let i = 0; i < 20 && !watching; i += 1) {
    await sleep(300)
    watching = await page.evaluate(`!!document.querySelector('video')`)
  }
  const watchShell = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav?.querySelector('[aria-current="page"]')
    return {
      nav: !!nav,
      likeX: document.querySelector('.bili-tri-btn[aria-label="点赞"]')?.getBoundingClientRect().x,
      width: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
      current: hit ? hit.getAttribute('aria-label') || hit.textContent?.trim() || 'current' : '',
      currentCount: nav ? nav.querySelectorAll('[aria-current="page"]').length : 0,
    }
  })()`)
  check(
    `观看页保留可收起的左栏并高亮来源 ${JSON.stringify(watchShell)}`,
    watching && watchShell.nav && watchShell.width <= 64 && watchShell.currentCount === 1,
  )
  check('进入观看页时点赞按钮在首帧就能点中原位置',
    opened && Math.abs(opened.likeX - watchShell.likeX) <= 1)
  await page.evaluate(
    `document.querySelector('nav[aria-label="主导航"] button[aria-label="展开侧边栏"]')?.click()`,
  )
  await sleep(400)
  const expanded = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    return { width: nav ? Math.round(nav.getBoundingClientRect().width) : 0 }
  })()`)
  check('观看页左栏可以展开', expanded.width >= 200)

  await page.evaluate(`document.querySelector('nav[aria-label="主导航"] [aria-label="收起侧边栏"]').click()`)
  await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
  await sleep(1500)
  const back = await page.evaluate(`(() => {
    const active = document.activeElement
    const card = active?.closest?.('[data-track-card]')
    return {
      key: card?.dataset.key ?? null,
      label: active?.getAttribute('aria-label') ?? '',
    }
  })()`)
  check(
    '从观看页返回后焦点回到进来的那张卡',
    watching && opened !== null && back.key === opened.key && back.label.startsWith('观看'),
  )

  const homeToggle = `document.querySelector('nav[aria-label="主导航"] button[aria-expanded]')`
  check('观看页收起左栏后，返回发现仍使用原来的展开设置',
    await page.evaluate(`${homeToggle}?.getAttribute('aria-expanded') === 'true'`))

  await clickDiscoveryButton(page, discoveryNav, '全部分区')
  await clickDiscoveryButton(page, discoveryDirectory, '音乐')
  const waitFor = watchUiWait(page)
  const cardButton = '[data-home-region] [data-track-card] button[aria-label^="观看"]'
  await waitFor(`document.querySelector(${JSON.stringify(cardButton)})`)
  const partitionKey = await page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(cardButton)})
    const key = button.closest('[data-track-card]').dataset.key
    button.click()
    return key
  })()`)
  await waitFor("document.querySelector('video')")
  await page.evaluate(`document.querySelector('button[aria-label="返回"]').click()`)
  await waitFor("document.activeElement?.closest('[data-home-region] [data-track-card]')")
  const partitionBack = await page.evaluate(`({
    selected: document.querySelector('[aria-label="发现分区"] [aria-pressed="true"]')?.textContent.trim(),
    key: document.activeElement.closest('[data-track-card]')?.dataset.key,
    recommend: !!document.querySelector('[data-home-recommend]'),
  })`)
  check('选中音乐后打开投稿，返回仍在音乐分区并聚焦原视频',
    partitionBack.selected === '音乐' && partitionBack.key === partitionKey && !partitionBack.recommend)
}

/** 排行榜：单列、名次独立成列，窄窗统计下移，返回同一分区与位置。 */
async function checkRanking(page) {
  await page.viewport(1440, 900)
  const url = new URL(WEB)
  url.searchParams.set('slowRanking', '1')
  await page.evaluate(`location.href = ${JSON.stringify(url.href)}`)
  await sleep(4000)
  await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '排行榜') : null
    hit?.focus()
    hit?.click()
  })()`)
  const waitForRows = async () => {
    for (let i = 0; i < 30; i += 1) {
      if (await page.evaluate(`document.querySelectorAll('[data-rank-row]').length >= 9`)) return true
      await sleep(300)
    }
    return false
  }
  const ready = await waitForRows()
  const wide = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-rank-row]')]
    const lefts = rows.slice(0, 9).map((row) => Math.round(row.getBoundingClientRect().left))
    const rights = rows.slice(0, 12).map((row) => Math.round(row.firstElementChild.getBoundingClientRect().right))
    const box = document.getElementById('scroll-main')
    return {
      tenth: rows[9]?.dataset.rank ?? '',
      sameLeft: new Set(lefts).size === 1,
      rankAligned: new Set(rights).size === 1,
      overflow: box ? box.scrollWidth - box.clientWidth : null,
      firstCover: Math.round(rows[0]?.querySelector('.aspect-video')?.getBoundingClientRect().width ?? 0),
      nextCover: Math.round(rows[1]?.querySelector('.aspect-video')?.getBoundingClientRect().width ?? 0),
    }
  })()`)
  check(
    '排行榜单列排成一张榜，名次右缘贯穿整页',
    ready && wide.sameLeft && wide.rankAligned && wide.tenth === '10',
  )
  check(
    '第一名封面更大，宽窗没有横向滚动',
    wide.firstCover > wide.nextCover && wide.overflow !== null && wide.overflow <= 0,
  )
  // 用一条真实长度的长标题压一下，标题列不能把行撑高。
  const originalTitle = await page.evaluate(`document.querySelector('[data-rank-title]')?.textContent ?? ''`)
  const clamp = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-rank-row]')]
    const title = rows[0]?.querySelector('[data-rank-title]')
    const probe = '一场酣畅淋漓的人类高质量灵魂对话，从北疆的雪到南方的雨，我们把这一路的见闻都记了下来，顺便聊聊为什么大家都在讨论这件事'
    if (title) title.textContent = probe + probe
    const heights = rows.slice(0, 12).map((row) => Math.round(row.getBoundingClientRect().height))
    return {
      height: title ? Math.round(title.getBoundingClientRect().height) : 0,
      tallest: heights.length > 0 ? Math.max(...heights) : 0,
      first: Math.round(rows[0]?.getBoundingClientRect().height ?? 0),
      second: Math.round(rows[1]?.getBoundingClientRect().height ?? 0),
    }
  })()`)
  check(
    '长标题最多两行，行高不被撑开',
    clamp.height > 0 && clamp.height <= 52 && clamp.first > 0 && clamp.first <= 140 && clamp.tallest <= 150,
  )
  // 768–1023 有侧栏时，标题列不能被统计列挤成一条缝。
  const midWidths = []
  for (const width of [768, 900]) {
    await page.viewport(width, 820)
    await sleep(500)
    midWidths.push(
      await page.evaluate(`(() => {
        const row = document.querySelector('[data-rank-row]')
        const titleButton = row?.querySelector('[data-rank-title]')?.closest('button')
        const box = document.getElementById('scroll-main')
        return {
          width: window.innerWidth,
          title: titleButton ? Math.round(titleButton.getBoundingClientRect().width) : 0,
          stats: row ? getComputedStyle(row.lastElementChild).display : '',
          overflow: box ? box.scrollWidth - box.clientWidth : null,
        }
      })()`),
    )
  }
  check(
    `768 与 900 下标题列仍有足够宽度 ${JSON.stringify(midWidths)}`,
    midWidths.every((item) => item.title >= 150 && item.stats === 'none' && item.overflow !== null && item.overflow <= 0),
  )
  await page.evaluate(`(() => {
    const title = document.querySelector('[data-rank-title]')
    if (title) title.textContent = ${JSON.stringify(originalTitle)}
  })()`)
  await page.viewport(1440, 900)
  await sleep(400)

  await page.evaluate(`document.getElementById('scroll-main').scrollTop = 400`)
  await sleep(300)
  await page.evaluate(`(() => {
    const row = document.querySelectorAll('[data-rank-row]')[4]
    row?.querySelector('button')?.click()
  })()`)
  let watching = false
  for (let i = 0; i < 20 && !watching; i += 1) {
    await sleep(300)
    watching = await page.evaluate(`!!document.querySelector('video')`)
  }
  await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
  await waitForRows()
  const back = await page.evaluate(`(() => {
    const box = document.getElementById('scroll-main')
    const part = document.querySelector('#scroll-main [aria-pressed="true"]')?.textContent?.trim() ?? ''
    return { top: box ? Math.round(box.scrollTop) : null, part, rows: document.querySelectorAll('[data-rank-row]').length }
  })()`)
  check(
    `从视频返回仍在该分区和原来的名次附近（400 → ${back.top}，${back.part}）`,
    watching && back.rows >= 9 && back.part === '全站' && back.top === 400,
  )

  await page.viewport(380, 820)
  await sleep(700)
  const narrow = await page.evaluate(`(() => {
    const row = document.querySelector('[data-rank-row]')
    const box = document.getElementById('scroll-main')
    return {
      cover: Math.round(row?.querySelector('.aspect-video')?.getBoundingClientRect().width ?? 0),
      rightStats: row ? getComputedStyle(row.lastElementChild).display : '',
      overflow: box ? box.scrollWidth - box.clientWidth : null,
    }
  })()`)
  check(
    '窄窗缩封面并把统计移到标题下',
    narrow.cover > 0 && narrow.cover <= 120 && narrow.rightStats === 'none' && narrow.overflow !== null && narrow.overflow <= 0,
  )
  await page.viewport(1440, 900)
}

/** 四个热门频道：桌面只由左栏切页，窄窗换成标题旁的选择器；排行分区与周刊换期各自留在内容里。 */
async function checkChannelNav(page) {
  const NAMES = ['排行榜', '综合热门', '入站必刷', '每周必看']
  const KINDS = ['ranking', 'popular', 'precious', 'weekly']
  const waitFor = async (expression, timeout = 6000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(100)
    }
    return false
  }
  const clickSidebar = (name) =>
    page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]')
      const hit = [...(nav?.querySelectorAll('[data-hot-channel]') ?? [])]
        .find((button) => (button.getAttribute('aria-label') || button.textContent.trim()) === ${JSON.stringify(name)})
      hit?.click()
      return !!hit
    })()`)
  const activeSidebar = () =>
    page.evaluate(`(() => {
      const hit = document.querySelector('nav[aria-label="主导航"] [data-hot-channel][aria-current="page"]')
      return hit ? (hit.getAttribute('aria-label') || hit.textContent.trim()) : ''
    })()`)
  const selectChannel = (kind) =>
    page.evaluate(`(() => {
      const select = document.querySelector('[data-hot-channel-select]')
      if (!select) return false
      select.value = ${JSON.stringify(kind)}
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)

  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(4000)
  const wideNav = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const buttons = [...(nav?.querySelectorAll('[data-hot-channel]') ?? [])]
      .filter((button) => button.getClientRects().length > 0)
    return {
      labels: buttons.map((button) => button.getAttribute('aria-label') || button.textContent.trim()),
      select: [...document.querySelectorAll('[data-hot-channel-select]')]
        .filter((select) => select.getClientRects().length > 0).length,
    }
  })()`)
  check(
    '宽窗左栏按统一顺序列出四个频道，正文不再重复',
    JSON.stringify(wideNav.labels) === JSON.stringify(NAMES) && wideNav.select === 0,
  )

  const wideStates = []
  for (let i = 0; i < NAMES.length; i += 1) {
    const clicked = await clickSidebar(NAMES[i])
    const ready = clicked && await waitFor(
      `document.querySelector('[data-hot-page]')?.dataset.hotPage === ${JSON.stringify(KINDS[i])}`,
    )
    const state = ready && await page.evaluate(`(() => ({
      pages: document.querySelectorAll('[data-hot-page]').length,
      select: [...document.querySelectorAll('[data-hot-channel-select]')]
        .filter((select) => select.getClientRects().length > 0).length,
      navs: document.querySelectorAll('main nav').length,
      channelButtons: [...document.querySelectorAll('main button')]
        .filter((button) => ${JSON.stringify(NAMES)}.includes((button.textContent || '').trim())).length,
    }))()`)
    wideStates.push({ ready, active: ready ? await activeSidebar() : '', ...state })
  }
  const wideOk = wideStates.every((state, i) =>
    state.ready &&
    state.active === NAMES[i] &&
    state.pages === 1 &&
    state.select === 0 &&
    state.navs === 0 &&
    state.channelButtons === 0)
  check('宽窗依次进入四页，每页只出现一组频道导航', wideOk)
  if (!wideOk) console.log(wideStates)

  const collapsed = await page.evaluate(`(() => {
    const hit = document.querySelector('nav[aria-label="主导航"] button[aria-label="收起侧边栏"]')
    hit?.click()
    return !!hit
  })()`)
  await sleep(400)
  const railNav = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    return {
      width: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
      labels: [...(nav?.querySelectorAll('[data-hot-channel]') ?? [])]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => button.getAttribute('aria-label') || button.textContent.trim()),
      select: [...document.querySelectorAll('[data-hot-channel-select]')]
        .filter((select) => select.getClientRects().length > 0).length,
    }
  })()`)
  check(
    '图标侧栏仍保留同一组频道与顺序',
    collapsed && railNav.width <= 64 && JSON.stringify(railNav.labels) === JSON.stringify(NAMES) && railNav.select === 0,
  )
  const railStates = []
  for (let i = 0; i < NAMES.length; i += 1) {
    const clicked = await clickSidebar(NAMES[i])
    const ready = clicked && await waitFor(
      `document.querySelector('[data-hot-page]')?.dataset.hotPage === ${JSON.stringify(KINDS[i])}`,
    )
    railStates.push({ ready, active: ready && await activeSidebar() })
  }
  check(
    '图标侧栏可以依次进入四页',
    railStates.every((state, i) => state.ready && state.active === NAMES[i]),
  )
  await page.evaluate(`document.querySelector('nav[aria-label="主导航"] button[aria-label="展开侧边栏"]')?.click()`)
  await sleep(300)

  await page.viewport(380, 820)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(3500)
  const homeEntry = await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '热门')
    hit?.click()
    return !!hit
  })()`)
  const popularReady = homeEntry && await waitFor(
    `document.querySelector('[data-hot-page]')?.dataset.hotPage === 'popular'`,
  )
  const narrowNav = await page.evaluate(`(() => {
    const select = document.querySelector('[data-hot-channel-select]')
    const sidebar = document.querySelector('nav[aria-label="主导航"]')
    return {
      visible: !!select && select.getClientRects().length > 0,
      options: select ? [...select.options].map((option) => option.textContent) : [],
      sidebar: sidebar ? sidebar.getClientRects().length : 0,
    }
  })()`)
  check(
    '窄窗没有左栏，页标题旁的频道选择器列出四页',
    popularReady && narrowNav.visible && narrowNav.sidebar === 0 &&
      JSON.stringify(narrowNav.options) === JSON.stringify(NAMES),
  )
  const narrowStates = []
  for (let i = 0; i < KINDS.length; i += 1) {
    const changed = await selectChannel(KINDS[i])
    const ready = changed && await waitFor(
      `document.querySelector('[data-hot-page]')?.dataset.hotPage === ${JSON.stringify(KINDS[i])}`,
    )
    const state = ready && await page.evaluate(`(() => ({
      value: document.querySelector('[data-hot-channel-select]')?.value ?? '',
      pages: document.querySelectorAll('[data-hot-page]').length,
      select: [...document.querySelectorAll('[data-hot-channel-select]')]
        .filter((select) => select.getClientRects().length > 0).length,
    }))()`)
    // 换页后整页重挂，焦点应该落在新页的频道选择器上，而不是掉回 body。
    const focusReady = ready && await waitFor(
      `document.activeElement === document.querySelector('[data-hot-channel-select]')`,
      2000,
    )
    narrowStates.push({ ready, focusReady, ...state })
  }
  const narrowOk = narrowStates.every((state, i) =>
    state.ready && state.focusReady && state.value === KINDS[i] && state.pages === 1 && state.select === 1)
  check('窄窗用页标题选择器走遍四页', narrowOk)
  if (!narrowOk) console.log(narrowStates)

  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(3500)
  await clickSidebar('排行榜')
  await waitFor(`document.querySelector('[data-hot-page]')?.dataset.hotPage === 'ranking'`)
  await waitFor(`document.querySelectorAll('[data-rank-row]').length >= 9`, 8000)
  const rankFirstTitle = () =>
    page.evaluate(`(document.querySelector('[data-rank-row] [data-rank-title]')?.textContent || '').trim()`)
  const allTitle = await rankFirstTitle()
  const musicClicked = await page.evaluate(`(() => {
    const row = document.querySelector('[data-hot-page="ranking"] [role="group"]')
    const hit = [...(row?.querySelectorAll('button') ?? [])].find((button) => button.textContent.trim() === '音乐')
    hit?.click()
    return !!hit
  })()`)
  const musicReady = musicClicked && await waitFor(`(() => {
    const page = document.querySelector('[data-hot-page="ranking"]')
    return page?.querySelector('[aria-pressed="true"]')?.textContent.trim() === '音乐' &&
      document.querySelectorAll('[data-rank-row]').length >= 9
  })()`, 8000)
  const musicTitle = await rankFirstTitle()
  const rankParts = await page.evaluate(`(() => {
    const groups = document.querySelectorAll('[data-hot-page="ranking"] [role="group"][aria-label="榜单分区"]')
    const pressed = [...document.querySelectorAll('[data-hot-page="ranking"] [role="group"] [aria-pressed]')]
    return {
      groups: groups.length,
      pressed: pressed.length,
      trueCount: pressed.filter((button) => button.getAttribute('aria-pressed') === 'true').length,
    }
  })()`)
  const openedRank = await page.evaluate(`(() => {
    const row = document.querySelector('[data-rank-row]')
    const hit = row?.querySelector('button')
    hit?.click()
    return !!hit
  })()`)
  let rankingVideo = false
  for (let i = 0; i < 24 && !rankingVideo; i += 1) {
    await sleep(250)
    rankingVideo = await page.evaluate(`!!document.querySelector('video')`)
  }
  await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
  const rankingBack = await waitFor(`(() => {
    const page = document.querySelector('[data-hot-page="ranking"]')
    return page?.querySelector('[aria-pressed="true"]')?.textContent.trim() === '音乐' &&
      document.querySelectorAll('[data-rank-row]').length >= 9
  })()`, 8000)
  const rankingState = rankingBack && await page.evaluate(`(() => ({
    page: document.querySelector('[data-hot-page]')?.dataset.hotPage ?? '',
    part: document.querySelector('[data-hot-page="ranking"] [aria-pressed="true"]')?.textContent.trim() ?? '',
    rows: document.querySelectorAll('[data-rank-row]').length,
    title: (document.querySelector('[data-rank-row] [data-rank-title]')?.textContent || '').trim(),
    select: [...document.querySelectorAll('[data-hot-channel-select]')]
      .filter((select) => select.getClientRects().length > 0).length,
  }))()`)
  check(
    '排行榜切音乐后打开视频返回仍在音乐榜，且只有一排分区',
    musicReady && openedRank && rankingVideo && rankingBack &&
      rankingState.page === 'ranking' && rankingState.part === '音乐' &&
      rankingState.rows >= 9 && rankingState.select === 0 &&
      rankParts.groups === 1 && rankParts.pressed === 13 && rankParts.trueCount === 1 &&
      allTitle.includes('分区 0') && musicTitle.includes('分区 3') &&
      rankingState.title === musicTitle,
  )
  if (rankParts.groups !== 1 || rankParts.pressed !== 13 || rankParts.trueCount !== 1) console.log(rankParts)

  await page.viewport(768, 820)
  await sleep(500)
  const overflow = await page.evaluate(`(() => {
    const row = document.querySelector('[data-hot-page="ranking"] [role="group"]')
    const buttons = [...(row?.querySelectorAll('button') ?? [])]
    buttons[0]?.focus()
    return row
      ? {
        overflow: row.scrollWidth - row.clientWidth,
        first: buttons[0]?.textContent.trim() ?? '',
        last: buttons.at(-1)?.textContent.trim() ?? '',
      }
      : null
  })()`)
  let tabbed = null
  for (let i = 0; i < 16; i += 1) {
    await page.keyEvent({ type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await page.keyEvent({ type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await sleep(60)
    tabbed = await page.evaluate(`(() => {
      const row = document.querySelector('[data-hot-page="ranking"] [role="group"]')
      const active = document.activeElement
      if (!row || !active || !row.contains(active)) return null
      const box = row.getBoundingClientRect()
      const rect = active.getBoundingClientRect()
      return {
        text: (active.textContent || '').trim(),
        inside: rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5,
        scrollLeft: Math.round(row.scrollLeft),
      }
    })()`)
    if (tabbed?.text === '汽车') break
  }
  check(
    '键盘可以走到横向溢出的最后一个排行分区',
    overflow?.overflow > 0 && tabbed?.text === '汽车' && tabbed.inside && tabbed.scrollLeft > 0,
  )

  await page.viewport(1440, 900)
  await sleep(300)
  await clickSidebar('每周必看')
  await waitFor(`document.querySelector('[data-hot-page]')?.dataset.hotPage === 'weekly'`)
  await waitFor(`!!document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')`, 8000)
  await waitFor(`!!document.querySelector('[data-weekly-issue] .bili-card')`, 8000)
  const weeklyLayout = await page.evaluate(`(() => {
    const header = document.querySelector('[data-hot-page="weekly"]')
    const rect = (element) => {
      const box = element?.getBoundingClientRect()
      return box ? { top: box.top, bottom: box.bottom, left: box.left, right: box.right } : null
    }
    return {
      header: rect(header),
      title: rect(header?.querySelector('h2')),
      prev: rect(header?.querySelector('button[aria-label="上一期"]')),
      picker: rect(header?.querySelector('[aria-haspopup="listbox"]')),
      next: rect(header?.querySelector('button[aria-label="下一期"]')),
      issue: rect(document.querySelector('[data-weekly-issue]')),
      subject: rect(document.querySelector('[data-weekly-issue] > h3')),
      first: rect(document.querySelector('[data-weekly-issue] [data-wide-card]')),
      cards: document.querySelectorAll('[data-weekly-issue] [data-wide-card]').length,
      select: [...document.querySelectorAll('[data-hot-channel-select]')]
        .filter((select) => select.getClientRects().length > 0).length,
    }
  })()`)
  check(
    '每周必看换期组紧邻页标题，当期主题和作品紧随其后',
    weeklyLayout.title && weeklyLayout.prev && weeklyLayout.picker && weeklyLayout.next &&
      weeklyLayout.prev.top >= weeklyLayout.title.top - 4 &&
      weeklyLayout.prev.top <= weeklyLayout.title.bottom &&
      weeklyLayout.prev.right <= weeklyLayout.picker.left + 1 &&
      weeklyLayout.picker.right <= weeklyLayout.next.left + 1 &&
      weeklyLayout.prev.left >= weeklyLayout.title.right &&
      weeklyLayout.prev.left - weeklyLayout.title.right <= 24 &&
      weeklyLayout.issue.top >= weeklyLayout.header.bottom - 1 &&
      weeklyLayout.issue.top - weeklyLayout.header.bottom <= 24 &&
      weeklyLayout.first.top >= (weeklyLayout.subject?.bottom ?? weeklyLayout.issue.top) - 1 &&
      weeklyLayout.first.top - (weeklyLayout.subject?.bottom ?? weeklyLayout.issue.top) <= 24 &&
      weeklyLayout.cards > 0 && weeklyLayout.select === 0,
  )

  const initial = await page.evaluate(`(() => ({
    label: document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim() ?? '',
    prev: document.querySelector('[data-hot-page="weekly"] button[aria-label="上一期"]')?.disabled,
    next: document.querySelector('[data-hot-page="weekly"] button[aria-label="下一期"]')?.disabled,
  }))()`)
  check('最新一期禁用下一期', initial.prev === false && initial.next === true)

  // 真鼠标点两下触发按钮：第一次开，第二次关（pointerdown 提前关、click 再开是回归点）。
  const triggerBox = await page.evaluate(`(() => {
    const box = document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.getBoundingClientRect()
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null
  })()`)
  const clickAt = async (point) => {
    await page.mouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
    await page.mouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  }
  let mouseOpened = false
  if (triggerBox) {
    await clickAt(triggerBox)
    mouseOpened = await waitFor(`!!document.querySelector('[role="listbox"]')`, 2000)
    await clickAt(triggerBox)
    await sleep(250)
  }
  const mouseClosed = await page.evaluate(`!document.querySelector('[role="listbox"]')`)
  check('鼠标点触发按钮可以展开和收起期数下拉', mouseOpened && mouseClosed)

  const prevClicked = await page.evaluate(`(() => {
    const hit = document.querySelector('[data-hot-page="weekly"] button[aria-label="上一期"]')
    hit?.click()
    return !!hit
  })()`)
  const prevReady = prevClicked && await waitFor(`(() => {
    const label = document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim()
    const grid = document.querySelector('[data-weekly-issue]')
    return label === '第398期' && grid?.dataset.weeklyIssue === '398'
  })()`, 8000)
  const afterPrev = prevReady && await page.evaluate(`(() => ({
    label: document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim() ?? '',
    issue: document.querySelector('[data-weekly-issue]')?.dataset.weeklyIssue ?? '',
    cards: document.querySelectorAll('[data-weekly-issue] .bili-card').length,
    next: document.querySelector('[data-hot-page="weekly"] button[aria-label="下一期"]')?.disabled,
    body: (document.querySelector('[data-weekly-issue] .bili-card')?.textContent || '').trim(),
  }))()`)
  check(
    '上一期按钮换期，期号与作品一起更新',
    afterPrev.label === '第398期' && afterPrev.issue === '398' && afterPrev.cards > 0 &&
      afterPrev.next === false && afterPrev.body.includes('第 398 期'),
  )

  await page.evaluate(`document.querySelector('[data-hot-page="weekly"] button[aria-label="上一期"]')?.focus()`)
  await page.pressSpace()
  await sleep(700)
  await page.pressSpace()
  await sleep(700)
  const afterKeys = await page.evaluate(`(() => ({
    label: document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim() ?? '',
    issue: document.querySelector('[data-weekly-issue]')?.dataset.weeklyIssue ?? '',
    focus: document.activeElement?.getAttribute('aria-label') ?? '',
  }))()`)
  check(
    '只用键盘连续按两次上一期',
    afterKeys.label === '第396期' && afterKeys.issue === '396' && afterKeys.focus === '上一期',
  )

  const openedPicker = await page.evaluate(`(() => {
    const hit = document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')
    hit?.click()
    return !!hit
  })()`)
  await waitFor(`!!document.querySelector('[role="listbox"]')`)
  const pickerFocus = await page.evaluate(`(() => ({
    role: document.activeElement?.getAttribute('role') ?? '',
    text: (document.activeElement?.textContent || '').trim(),
  }))()`)
  check(
    '期数下拉打开后焦点落在当前期',
    openedPicker && pickerFocus.role === 'option' && pickerFocus.text.startsWith('第 396 期'),
  )
  const end = { key: 'End', code: 'End', windowsVirtualKeyCode: 35 }
  await page.keyEvent({ type: 'keyDown', ...end })
  await page.keyEvent({ type: 'keyUp', ...end })
  await sleep(100)
  const atEnd = await page.evaluate(`(document.activeElement?.textContent || '').trim()`)
  await page.pressSpace()
  const oldestReady = await waitFor(`(() => {
    const label = document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim()
    const grid = document.querySelector('[data-weekly-issue]')
    return label === '第392期' && grid?.dataset.weeklyIssue === '392'
  })()`, 8000)
  const oldest = oldestReady && await page.evaluate(`(() => ({
    label: document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim() ?? '',
    issue: document.querySelector('[data-weekly-issue]')?.dataset.weeklyIssue ?? '',
    prev: document.querySelector('[data-hot-page="weekly"] button[aria-label="上一期"]')?.disabled,
    next: document.querySelector('[data-hot-page="weekly"] button[aria-label="下一期"]')?.disabled,
    list: !!document.querySelector('[role="listbox"]'),
    focus: document.activeElement?.getAttribute('aria-haspopup') ?? '',
  }))()`)
  check(
    '键盘在下拉里选到最早一期，上一期随即禁用',
    atEnd.startsWith('第 392 期') && oldest.label === '第392期' && oldest.issue === '392' &&
      oldest.prev === true && oldest.next === false && !oldest.list && oldest.focus === 'listbox',
  )

  const nextClicked = await page.evaluate(`(() => {
    const hit = document.querySelector('[data-hot-page="weekly"] button[aria-label="下一期"]')
    hit?.focus()
    return !!hit
  })()`)
  await page.pressSpace()
  await sleep(700)
  await page.pressSpace()
  await sleep(700)
  const afterNext = await page.evaluate(`(() => ({
    label: document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim() ?? '',
    issue: document.querySelector('[data-weekly-issue]')?.dataset.weeklyIssue ?? '',
    focus: document.activeElement?.getAttribute('aria-label') ?? '',
  }))()`)
  check(
    '下一期按钮也能用键盘连续换期',
    nextClicked && afterNext.label === '第394期' && afterNext.issue === '394' && afterNext.focus === '下一期',
  )

  await page.evaluate(`document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.click()`)
  await waitFor(`!!document.querySelector('[role="listbox"]')`)
  const tab = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }
  await page.keyEvent({ type: 'keyDown', ...tab })
  await page.keyEvent({ type: 'keyUp', ...tab })
  await sleep(300)
  const afterTab = await page.evaluate(`({
    list: !!document.querySelector('[role="listbox"]'),
    role: document.activeElement?.getAttribute('role') ?? '',
  })`)
  check('期数下拉按 Tab 离开就收起，不会逐项走过几百期', !afterTab.list && afterTab.role !== 'option')

  await page.evaluate(`document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.click()`)
  await waitFor(`!!document.querySelector('[role="listbox"]')`)
  const esc = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  await page.keyEvent({ type: 'keyDown', ...esc })
  await page.keyEvent({ type: 'keyUp', ...esc })
  await sleep(300)
  const afterEsc = await page.evaluate(`(() => ({
    list: !!document.querySelector('[role="listbox"]'),
    focus: document.activeElement?.getAttribute('aria-haspopup') ?? '',
  }))()`)
  check('期数下拉按 Esc 收起，焦点回到触发按钮', !afterEsc.list && afterEsc.focus === 'listbox')

  const weeklyOpened = await page.evaluate(`(() => {
    const card = document.querySelector('[data-weekly-issue] [data-wide-card] button[data-focus-id]')
    if (!card) return ''
    const focusId = card.dataset.focusId ?? ''
    card.click()
    return focusId
  })()`)
  let weeklyVideo = false
  for (let i = 0; i < 60 && !weeklyVideo; i += 1) {
    await sleep(250)
    weeklyVideo = await page.evaluate(`!!document.querySelector('video')`)
  }
  await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
  const weeklyBack = await waitFor(`(() => {
    const label = document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim()
    return label === '第394期' && !!document.querySelector('[data-weekly-issue="394"]')
  })()`, 12000)
  await sleep(600)
  const weeklyFocus = await page.evaluate(`document.activeElement?.dataset?.focusId ?? ''`)
  check(
    '从每周作品返回仍在这一期，焦点回到入口卡',
    weeklyVideo && weeklyBack && weeklyOpened.length > 0 && weeklyFocus === weeklyOpened,
  )
  if (weeklyFocus !== weeklyOpened) console.log({ weeklyVideo, weeklyBack, weeklyOpened, weeklyFocus })

  await page.viewport(380, 820)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(3500)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '热门')
    hit?.click()
  })()`)
  await waitFor(`document.querySelector('[data-hot-page]')?.dataset.hotPage === 'popular'`)
  await selectChannel('weekly')
  await waitFor(`document.querySelector('[data-hot-page]')?.dataset.hotPage === 'weekly'`)
  await waitFor(`!!document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')`, 8000)
  await waitFor(`!!document.querySelector('[data-weekly-issue] .bili-card')`, 8000)
  const narrowWeekly = await page.evaluate(`(() => {
    const header = document.querySelector('[data-hot-page="weekly"]')
    const rect = (element) => {
      const box = element?.getBoundingClientRect()
      return box ? { top: box.top, bottom: box.bottom, left: box.left, right: box.right } : null
    }
    return {
      header: rect(header),
      title: rect(header?.querySelector('h2')),
      select: rect(header?.querySelector('[data-hot-channel-select]')),
      prev: rect(header?.querySelector('button[aria-label="上一期"]')),
      picker: rect(header?.querySelector('[aria-haspopup="listbox"]')),
      next: rect(header?.querySelector('button[aria-label="下一期"]')),
      first: rect(document.querySelector('[data-weekly-issue] .bili-card')),
      label: document.querySelector('[data-hot-page="weekly"] [aria-haspopup="listbox"]')?.textContent.trim() ?? '',
      issue: document.querySelector('[data-weekly-issue]')?.dataset.weeklyIssue ?? '',
      body: (document.querySelector('[data-weekly-issue] .bili-card')?.textContent || '').trim(),
      overflow: (() => {
        const box = document.getElementById('scroll-main')
        return box ? box.scrollWidth - box.clientWidth : -1
      })(),
    }
  })()`)
  const narrowAdjacent =
    narrowWeekly.prev && narrowWeekly.picker && narrowWeekly.next &&
    narrowWeekly.prev.right <= narrowWeekly.picker.left + 1 &&
    narrowWeekly.picker.right <= narrowWeekly.next.left + 1
  check(
    '窄窗换期组整组落在标题下，仍在作品之前',
    narrowWeekly.title && narrowWeekly.select && narrowAdjacent &&
      narrowWeekly.prev.top >= narrowWeekly.title.bottom - 1 &&
      narrowWeekly.select.bottom <= narrowWeekly.prev.top + 1 &&
      narrowWeekly.next.right <= 380 &&
      narrowWeekly.first.top >= narrowWeekly.header.bottom - 1 &&
      Number(narrowWeekly.issue) > 0 &&
      narrowWeekly.label.includes(narrowWeekly.issue) &&
      narrowWeekly.body.includes(`第 ${narrowWeekly.issue} 期`) &&
      narrowWeekly.overflow >= 0 &&
      narrowWeekly.overflow <= 0,
  )
  if (narrowWeekly.overflow > 0 || !narrowWeekly.body.includes(`第 ${narrowWeekly.issue} 期`)) {
    console.log({ issue: narrowWeekly.issue, label: narrowWeekly.label, overflow: narrowWeekly.overflow })
  }
  if (!narrowAdjacent) console.log(narrowWeekly)
  await page.viewport(1320, 900)
}

/** 右栏只服务「听」的页面：在发现页开始播放不该自动拉出一栏歌词。 */
async function checkRailScope(page) {
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(4500)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')]
      .find((button) => (button.getAttribute('aria-label') || '').startsWith('听 '))
    hit?.click()
  })()`)
  await sleep(1200)
  const home = await page.evaluate(`(() => {
    const slot = document.querySelector('.rail-slot')
    return {
      playing: !!document.querySelector('button[aria-label="暂停"]'),
      open: slot?.getAttribute('data-open') === 'true',
      width: slot ? Math.round(slot.getBoundingClientRect().width) : 0,
    }
  })()`)
  check('发现页开始播放不自动拉出歌词右栏', home.playing && !home.open && home.width <= 1)

  await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '曲库') : null
    hit?.click()
  })()`)
  await sleep(1500)
  const library = await page.evaluate(`(() => {
    const slot = document.querySelector('.rail-slot')
    return {
      open: slot?.getAttribute('data-open') === 'true',
      width: slot ? Math.round(slot.getBoundingClientRect().width) : 0,
    }
  })()`)
  check('回到曲库后歌词右栏自动回来', library.open && library.width > 200)

  await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '发现') : null
    hit?.click()
  })()`)
  await sleep(1200)
  const backHome = await page.evaluate(`(() => {
    const slot = document.querySelector('.rail-slot')
    return {
      open: slot?.getAttribute('data-open') === 'true',
      width: slot ? Math.round(slot.getBoundingClientRect().width) : 0,
    }
  })()`)
  check('离开听歌页面后右栏收起', !backHome.open && backHome.width <= 1)
  await page.evaluate(`document.querySelector('button[aria-label="暂停"]')?.click()`)
}

/** 未设置置顶的多页作者，检查不同排序和窗口大小下的首排投稿。 */
async function checkAuthorSpace(page) {
  const wait = watchUiWait(page)
  const card = 'document.querySelector("#scroll-main [data-track-card]")'
  const header = 'document.querySelector("header[data-up-mid]")'
  const scroll = 'document.getElementById("scroll-main")'
  const keys = () => page.evaluate(`Array.from(${scroll}.querySelectorAll('[data-track-card]'), card => card.dataset.key)`)
  const loadAll = async () => {
    let current = []
    for (let attempt = 0; attempt < 60; attempt += 1) {
      current = await keys()
      if (current.length === 125) break
      await page.evaluate(`${scroll}.scrollTop = ${scroll}.scrollHeight`)
      await sleep(300)
    }
    return current
  }

  await page.viewport(1320, 900)
  const query = '?authorLong=1&spaceSlowMid=900015'
  await page.evaluate(`location.href = ${JSON.stringify(WEB + query)}`)
  const discoveryCover = `document.querySelector('[data-track-card]:has(button[aria-label="UP 张学友"]) button[aria-label^=观看]')`
  await wait(`location.search === ${JSON.stringify(query)} && ${discoveryCover}`)
  await page.evaluate(`${discoveryCover}.click()`)
  const owner = `document.querySelector('button[aria-label^="看 "][aria-label$="的更多视频"]')`
  await wait(owner)
  const ownerLabel = await page.evaluate(`${owner}.getAttribute('aria-label')`)
  await page.evaluate(`${owner}.click()`)
  await wait(`${header} && ${card}?.querySelector('h3')`)
  const firstTitle = await page.evaluate(`${card}.dataset.trackTitle`)
  check('从观看页进入投稿作者的空间，作品属于同一位作者', await page.evaluate(`(() => {
    const name = ${header}.querySelector('h2')?.textContent.trim()
    return ${JSON.stringify(ownerLabel)} === '看 ' + name + ' 的更多视频' &&
      ${card}.querySelector('button[aria-label^="UP "]')?.getAttribute('aria-label') === 'UP ' + name
  })()`))
  check('桌面首屏能看到完整投稿封面及标题，无置顶的作者直接展示最新作品', await page.evaluate(`
    !document.querySelector('[data-space-pinned]') &&
    ${card}.dataset.trackTitle.endsWith('第 1 期') &&
    ${card}.querySelector('h3').getBoundingClientRect().bottom <= ${scroll}.getBoundingClientRect().bottom`))

  // 第一页 50 条刚显示时，第二页仍在路上；此刻换序也要拿全新排序的后两页。
  await wait(`${header}.dataset.upMid === '900015' && ${scroll}.querySelectorAll('[data-track-card]').length === 50 &&
    [...${scroll}.querySelectorAll('[role=status]')].some(node => node.textContent.includes('正在取更多投稿'))`)
  await page.clickExactText('最多播放')
  await wait(`${card}.dataset.trackTitle.endsWith('第 125 期')`)
  check('最多播放首位换成播放数最高的一期', await page.evaluate(`${card}.dataset.trackTitle !== ${JSON.stringify(firstTitle)}`))

  const played = await loadAll()
  check(`第二页加载中切换排序，能继续取完新排序的 125 条（实际 ${played.length} 条）`,
    played.length === 125 && new Set(played).size === 125)
  await page.evaluate(`${scroll}.scrollTop = 380`)
  await page.clickExactText('最多收藏')
  await wait(`[...document.querySelectorAll('button[aria-pressed=true]')].some(b => b.textContent.trim() === '最多收藏')`)
  check('切最多收藏时仍停留在原滚动位置', await page.evaluate(`${header} && ${scroll}.scrollTop >= 300`))

  await wait(`!${card}.dataset.trackTitle.endsWith('第 125 期')`)
  const collected = await loadAll()
  check('切换排序前后，两次都能翻到完整的 125 个不同投稿和正确总数',
    new Set(collected).size === 125 && new Set(played).size === 125 &&
    collected.slice().sort().join() === played.slice().sort().join() &&
    await page.evaluate(`${header}.textContent.includes('共 125 个投稿')`))

  check('空间第 85 条投稿在侧栏连续开合两次后仍回到原来的高度', await page.evaluate(`(async () => {
    const box = ${scroll}
    const cards = box.querySelectorAll('[data-track-card]')
    const card = cards[84]
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const toggle = nav.querySelector('button[aria-expanded]')
    const frame = () => new Promise(requestAnimationFrame)
    cards[81].scrollIntoView({ block: 'start', behavior: 'instant' })
    await frame()
    const originalTop = card.getBoundingClientRect().top
    for (const expanded of ['false', 'true', 'false', 'true']) {
      toggle.click()
      await frame()
      await Promise.allSettled(nav.getAnimations().map(slide => slide.finished))
      await frame()
      await frame()
      const rect = card.getBoundingClientRect()
      const viewport = box.getBoundingClientRect()
      if (toggle.getAttribute('aria-expanded') !== expanded ||
        rect.bottom <= viewport.top || rect.top >= viewport.bottom ||
        (expanded === 'true' && Math.abs(rect.top - originalTop) > 2)) return false
    }
    return true
  })()`))
  await page.viewport(380, 820)
  await page.evaluate(`${scroll}.scrollTop = 0`)
  check('窄窗作者在前，首屏有作品封面和标题，内容没有横向溢出', await page.evaluate(`(() => {
    const box = ${scroll}
    const title = ${card}.querySelector('h3').getBoundingClientRect()
    const cover = ${card}.querySelector('button[aria-label^=观看]').getBoundingClientRect()
    return box.scrollWidth <= box.clientWidth && cover.width > 0 && cover.height > 0 &&
      ${header}.getBoundingClientRect().bottom <= cover.top && title.bottom <= box.getBoundingClientRect().bottom
  })()`))
  await page.viewport(1320, 900)
}

/**
 * 关注目录：全量索引、跨页搜索、关系筛选、失败续查、换账号、作品返回与窄窗。
 */
async function checkFollowingDirectory(page) {
  const waitFor = async (expression, timeout = 6000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(120)
    }
    return false
  }
  const openFollowing = async (params = {}) => {
    const url = new URL(WEB)
    url.searchParams.set('loggedIn', '1')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    await page.evaluate(`location.href = ${JSON.stringify(url.href)}`)
    await sleep(900)
    await waitFor(`!!document.querySelector('nav[aria-label="主导航"]')`, 10000)
    const clicked = await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '关注') : null
      hit?.click()
      return !!hit
    })()`)
    await waitFor(`!!document.querySelector('[data-following-directory]')`, 10000)
    return clicked
  }
  const setInput = async (value) => {
    const ok = await page.evaluate(`(() => {
      const input = document.querySelector('[data-following-search]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(700)
    return ok
  }
  const setFilter = async (value) => {
    const ok = await page.evaluate(`(() => {
      const hit = document.querySelector('[data-following-filter=${JSON.stringify(value)}]')
      hit?.click()
      return !!hit
    })()`)
    await sleep(500)
    return ok
  }
  const rows = () =>
    page.evaluate(
      `[...document.querySelectorAll('[data-following-author]')].map((b) => ({ mid: b.dataset.followingAuthor, name: b.innerText.split('\\n')[1], text: b.innerText }))`,
    )
  const detail = () =>
    page.evaluate(`(() => {
      const preview = document.querySelector('[data-following-preview]')
      return {
        mid: preview?.dataset.authorMid ?? null,
        works: [...document.querySelectorAll('[data-following-work]')].map((b) => b.dataset.followingWorkMid),
        progress: document.querySelector('[data-following-progress]')?.innerText ?? '',
        focus: document.activeElement?.getAttribute('data-focus-id') ?? '',
        query: document.querySelector('[data-following-search]')?.value ?? '',
        filters: [...document.querySelectorAll('[data-following-filter]')].map((b) => b.innerText),
      }
    })()`)
  const unique = async () => {
    const list = await rows()
    return { count: list.length, mids: new Set(list.map((row) => row.mid)).size }
  }
  const startErrors = page.runtimeErrors.length

  await page.viewport(1320, 900)
  check('打开关注目录', await openFollowing())
  check(
    '不预滚动就读完全部 320 个关注',
    await waitFor(
      `document.querySelector('[data-following-directory]')?.dataset.followingLoaded === '320' && !document.querySelector('[data-following-progress]')`,
      20000,
    ),
  )
  const initial = await page.evaluate(`(() => {
    const root = document.querySelector('[data-following-directory]')
    return {
      loaded: root?.dataset.followingLoaded,
      total: root?.dataset.followingTotal,
      scrollTop: root?.scrollTop,
      search: !!document.querySelector('[data-following-search]'),
      filters: [...document.querySelectorAll('[data-following-filter]')].map((b) => b.innerText),
    }
  })()`)
  const initialRows = await unique()
  check(
    `目录首屏显示搜索与关系筛选 ${JSON.stringify(initial)}`,
    initial.loaded === '320' && initial.total === '320' && initial.scrollTop === 0 &&
      initial.search && initial.filters[0]?.includes('320'),
  )
  check(
    `320 人按 mid 去重 ${JSON.stringify(initialRows)}`,
    initialRows.count === 320 && initialRows.mids === 320,
  )

  await setInput('混音')
  const hitWord = await waitFor(
    `document.querySelectorAll('[data-following-author]').length === 1 && document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5285'`,
  )
  await setFilter('mutual')
  const hitMutual = await waitFor(
    `document.querySelectorAll('[data-following-author]').length === 1 && document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5285'`,
  )
  const narrowed = await detail()
  check(
    `不滚到末页也能搜到第 286 人并和互关组合 ${JSON.stringify(narrowed)}`,
    hitWord && hitMutual && narrowed.filters[2]?.includes('1'),
  )
  check(
    '选中作者的预览只显示他自己的投稿',
    (await waitFor(
      `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5285' && document.querySelectorAll('[data-following-work]').length > 0`,
    )) && (await detail()).works.every((mid) => mid === '5285'),
  )

  await setFilter('all')
  await setInput('  lOfI  ')
  const lofi = await waitFor(
    `document.querySelectorAll('[data-following-author]').length === 1 && document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5100'`,
  )
  await setInput('  cHiLl  ')
  const chill = await waitFor(
    `document.querySelectorAll('[data-following-author]').length === 1 && document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5100'`,
  )
  check('英文大小写混排与前后空格仍能命中昵称和签名', lofi && chill)

  await setInput('同名作者')
  const twins = await waitFor(`document.querySelectorAll('[data-following-author]').length === 2`)
  const twinRows = await rows()
  await page.evaluate(`document.querySelector('[data-following-author="5010"]')?.click()`)
  const firstTwin = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5010'`,
  )
  await page.evaluate(`document.querySelector('[data-following-author="5300"]')?.click()`)
  const secondTwin = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5300'`,
  )
  check(
    `同名作者按 mid 区分 ${JSON.stringify(twinRows.map((row) => row.mid))}`,
    twins && twinRows.length === 2 && twinRows[0]?.mid === '5010' && twinRows[1]?.mid === '5300' &&
      firstTwin && secondTwin,
  )

  await setInput('')
  await waitFor(`document.querySelectorAll('[data-following-author]').length === 320`)
  const keyboard = await page.evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-following-author]')]
    all[0]?.focus()
    all[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    return { first: all[0]?.dataset.followingAuthor, second: all[1]?.dataset.followingAuthor, focus: document.activeElement?.dataset.followingAuthor }
  })()`)
  await sleep(100)
  const keyboardFocus = await page.evaluate(
    `document.activeElement?.dataset.followingAuthor ?? ''`,
  )
  check(
    `键盘方向键在名单里连续移动 ${JSON.stringify(keyboard)} → ${keyboardFocus}`,
    keyboard.second === keyboardFocus && keyboardFocus !== keyboard.first,
  )
  const overflow = await page.evaluate(`(() => {
    const root = document.querySelector('[data-following-directory]')
    return root ? root.scrollWidth - root.clientWidth : -1
  })()`)
  check('长名单不横向溢出', overflow !== null && overflow <= 0)

  await setInput('长到可以')
  const longReady = await waitFor(
    `document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5050'`,
  )
  const longRow = await page.evaluate(`(() => {
    const button = document.querySelector('[data-following-author="5050"]')
    return button ? { height: Math.round(button.getBoundingClientRect().height), text: button.innerText } : null
  })()`)
  check(
    `长昵称和无签名只收紧行高 ${JSON.stringify(longRow)}`,
    longReady && longRow && longRow.height <= 64 && !longRow.text.includes('这个人很神秘'),
  )
  await page.evaluate(`document.querySelector('[data-following-author="5050"]')?.click()`)
  const longDetail = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5050'`,
  )
  check('无签名的作者预览不留空行', longDetail)

  await setInput('没有投稿')
  const emptyReady = await waitFor(
    `document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5051'`,
  )
  await page.evaluate(`document.querySelector('[data-following-author="5051"]')?.click()`)
  const emptyDetail = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5051' && document.body.innerText.includes('暂无近期投稿')`,
  )
  check(
    '无投稿作者仍有进入空间的出口',
    emptyReady && emptyDetail &&
      (await page.evaluate(`!!document.querySelector('[data-following-space]')?.getClientRects().length`)),
  )

  await setInput('关注作者')
  await waitFor(`document.querySelectorAll('[data-following-author]').length > 100`)
  await page.evaluate(`document.getElementById('scroll-main').scrollTop = 500`)
  await sleep(250)
  const beforeWork = await page.evaluate(`Math.round(document.getElementById('scroll-main')?.scrollTop ?? 0)`)
  await page.evaluate(`document.querySelector('[data-following-author="5011"]')?.click()`)
  await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5011' && document.querySelectorAll('[data-following-work]').length > 0`,
  )
  await page.evaluate(`document.querySelector('[data-following-work]')?.click()`)
  await waitFor(`!!document.querySelector('button[aria-label="返回"]')`, 10000)
  await sleep(800)
  await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
  const workBack = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5011'`,
    10000,
  )
  await sleep(800)
  const afterWork = await page.evaluate(`(() => ({
    query: document.querySelector('[data-following-search]')?.value ?? '',
    relation: document.querySelector('[data-following-filter="all"]')?.getAttribute('aria-pressed'),
    mid: document.querySelector('[data-following-preview]')?.dataset.authorMid ?? '',
    top: Math.round(document.getElementById('scroll-main')?.scrollTop ?? 0),
    focus: document.activeElement?.getAttribute('data-focus-id') ?? '',
  }))()`)
  check(
    `作品返回恢复搜索、关系、作者、锚点和焦点 ${JSON.stringify({ beforeWork, afterWork })}`,
    workBack && afterWork.query === '关注作者' && afterWork.relation === 'true' &&
      afterWork.mid === '5011' && Math.abs(afterWork.top - beforeWork) <= 80 &&
      afterWork.focus.startsWith('following-work:'),
  )

  await page.evaluate(`document.querySelector('[data-following-space]')?.click()`)
  const space = await waitFor(
    `document.querySelector('header[data-up-mid]')?.dataset.upMid === '5011'`,
    10000,
  )
  check(
    '从预览进入的作者空间就是当前作者',
    space && (await page.evaluate(`document.querySelector('header h2')?.textContent?.trim() ?? ''`)) === '关注作者 12',
  )
  await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '关注') : null
    hit?.click()
  })()`)
  const reentered = await waitFor(
    `document.querySelector('[data-following-directory]')` + ` && document.querySelector('[data-following-preview]')?.dataset.authorMid === '5011'`,
    10000,
  )
  check(
    '再次进入目录仍回到原作者',
    reentered && (await page.evaluate(`document.querySelector('[data-following-search]')?.value ?? ''`)) === '关注作者',
  )

  await page.viewport(390, 760)
  await sleep(700)
  const narrowInitial = await page.evaluate(`(() => ({
    preview: document.querySelector('[data-following-preview]')?.dataset.authorMid ?? '',
    back: !!document.querySelector('[data-following-back]'),
  }))()`)
  await page.evaluate(`document.querySelector('[data-following-back]')?.click()`)
  await sleep(500)
  const narrowList = await page.evaluate(`(() => ({
    list: [...document.querySelectorAll('[data-following-author]')].some((b) => b.getClientRects().length > 0),
    preview: !!document.querySelector('[data-following-preview]'),
  }))()`)
  check(
    `窄窗保留选中作者并可返回名单 ${JSON.stringify({ narrowInitial, narrowList })}`,
    narrowInitial.preview === '5011' && narrowInitial.back &&
      narrowList.list && !narrowList.preview,
  )
  await page.evaluate(`document.querySelector('[data-following-author="5011"]')?.click()`)
  const narrowOpen = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5011' && document.querySelectorAll('[data-following-work]').length > 0`,
    10000,
  )
  const narrowDetail = await page.evaluate(`(() => ({
    list: [...document.querySelectorAll('[data-following-author]')].some((b) => b.getClientRects().length > 0),
    back: !!document.querySelector('[data-following-back]'),
    space: !!document.querySelector('[data-following-space]'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))()`)
  check(
    `窄窗预览有独立返回与进入空间 ${JSON.stringify(narrowDetail)}`,
    narrowOpen && !narrowDetail.list && narrowDetail.back && narrowDetail.space && narrowDetail.overflow <= 0,
  )
  await page.evaluate(`document.querySelector('[data-following-work]')?.click()`)
  await waitFor(`!!document.querySelector('button[aria-label="返回"]')`, 10000)
  await sleep(800)
  await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
  const narrowBack = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5011'`,
    10000,
  )
  await sleep(800)
  const narrowRestored = await page.evaluate(`(() => ({
    query: document.querySelector('[data-following-search]')?.value ?? '',
    mid: document.querySelector('[data-following-preview]')?.dataset.authorMid ?? '',
    focus: document.activeElement?.getAttribute('data-focus-id') ?? '',
    list: [...document.querySelectorAll('[data-following-author]')].some((b) => b.getClientRects().length > 0),
  }))()`)
  check(
    `窄窗作品返回仍在原作者预览 ${JSON.stringify(narrowRestored)}`,
    narrowBack && narrowRestored.query === '关注作者' && narrowRestored.mid === '5011' &&
      !narrowRestored.list && narrowRestored.focus.startsWith('following-work:'),
  )
  await page.evaluate(`document.querySelector('[data-following-space]')?.click()`)
  check(
    '窄窗进入空间仍是当前作者',
    await waitFor(`document.querySelector('header[data-up-mid]')?.dataset.upMid === '5011'`, 10000),
  )

  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1`)}`)
  await sleep(1200)
  await waitFor(`!!document.querySelector('nav[aria-label="主要导航"]')`, 10000)
  const toMine = await page.clickExactText('我的')
  await sleep(600)
  const toFollowing = toMine && await page.clickExactText('关注')
  const freshNarrow = toFollowing && await waitFor(
    `document.querySelector('[data-following-directory]')?.dataset.followingLoaded === '320'`,
    20000,
  )
  await sleep(300)
  const freshNarrowState = await page.evaluate(`(() => ({
    list: [...document.querySelectorAll('[data-following-author]')].some((b) => b.getClientRects().length > 0),
    preview: !!document.querySelector('[data-following-preview]'),
    back: !!document.querySelector('[data-following-back]'),
  }))()`)
  check(
    `窄窗全新进入先看到名单 ${JSON.stringify(freshNarrowState)}`,
    freshNarrow && freshNarrowState.list && !freshNarrowState.preview && !freshNarrowState.back,
  )
  await page.viewport(1320, 900)

  check('打开第 3 页失败的关注目录', await openFollowing({ followFailPage: '3' }))
  const failed = await waitFor(
    `(() => {
      const progress = document.querySelector('[data-following-progress]')?.innerText ?? ''
      return progress.includes('已读 100 / 320') && progress.includes('第 3 页没取到')
    })()`,
    20000,
  )
  const failedState = await page.evaluate(`(() => ({
    loaded: document.querySelector('[data-following-directory]')?.dataset.followingLoaded,
    filters: [...document.querySelectorAll('[data-following-filter]')].map((b) => b.innerText),
    continueButton: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '继续检索'),
  }))()`)
  check(
    `缺页时保留已读范围并给出续查 ${JSON.stringify(failedState)}`,
    failed && failedState.loaded === '100' && failedState.continueButton &&
      failedState.filters[0]?.includes('320') && failedState.filters[1]?.includes('+') &&
      failedState.filters[2]?.includes('+'),
  )
  await setInput('混音')
  const partialNone = await waitFor(
    `document.querySelectorAll('[data-following-author]').length === 0 && document.body.innerText.includes('已读范围内暂无匹配')`,
  )
  check(
    '索引未齐时不说「没有匹配」',
    partialNone && !(await page.evaluate(`document.body.innerText.includes('没有匹配的作者')`)),
  )
  await setInput('造梦阿瑄')
  const pageOneHit = await waitFor(
    `document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5000'`,
  )
  await page.evaluate(`document.querySelector('[data-following-author="5000"]')?.click()`)
  check(
    '缺页前已读到的作者仍能预览作品',
    pageOneHit && await waitFor(
      `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5000' && document.querySelectorAll('[data-following-work]').length > 0`,
    ),
  )

  await page.evaluate(`performance.clearMarks('following_page')`)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '继续检索')
    hit?.click()
  })()`)
  const resumed = await waitFor(
    `document.querySelector('[data-following-directory]')?.dataset.followingLoaded === '320' && !document.querySelector('[data-following-progress]')`,
    20000,
  )
  const pages = await page.evaluate(
    `performance.getEntriesByName('following_page').map((entry) => entry.detail)`,
  )
  await setInput('')
  await waitFor(`document.querySelectorAll('[data-following-author]').length === 320`)
  const resumedUnique = await unique()
  check(
    `续查从第 3 页继续且结果无重复 ${JSON.stringify({ pages, resumedUnique })}`,
    resumed && pages[0] === 3 && new Set(pages).size === pages.length &&
      resumedUnique.count === 320 && resumedUnique.mids === 320,
  )
  await setInput('绝对不存在的作者')
  const noMatch = await waitFor(
    `document.querySelectorAll('[data-following-author]').length === 0 && document.body.innerText.includes('没有匹配的作者')`,
  )
  check('完整查询后才说没有匹配', noMatch)
  await setInput('混音')
  await setFilter('mutual')
  check(
    '续查后跨页搜索与互关仍然正确',
    await waitFor(
      `document.querySelector('[data-following-author]')?.dataset.followingAuthor === '5285'`,
    ),
  )

  check('慢速重新打开关注目录', await openFollowing({ followSlow: '1' }))
  await waitFor(
    `Number(document.querySelector('[data-following-directory]')?.dataset.followingLoaded ?? 0) >= 50`,
    10000,
  )
  await setInput('关注作者')
  await setInput('混音')
  const raced = await waitFor(
    `document.querySelector('[data-following-directory]')?.dataset.followingLoaded === '320' && !document.querySelector('[data-following-progress]')`,
    20000,
  )
  const racedRows = await rows()
  check(
    `旧分页响应不污染新搜索词 ${JSON.stringify(racedRows.map((row) => row.mid))}`,
    raced && racedRows.length === 1 && racedRows[0]?.mid === '5285',
  )

  check('再次慢速打开关注目录', await openFollowing({ followSlow: '1' }))
  await waitFor(
    `Number(document.querySelector('[data-following-directory]')?.dataset.followingLoaded ?? 0) >= 50`,
    10000,
  )
  const openedAccount = await page.evaluate(
    `(() => { const hit = document.querySelector('button[aria-label="账号菜单"]'); hit?.click(); return !!hit })()`,
  )
  await sleep(300)
  const logout = openedAccount && await page.clickExactText('退出登录')
  const loggedOut = logout && await waitFor(
    `document.querySelector('main h2')?.textContent?.trim() === '关注列表没取到'`,
    10000,
  )
  const login = loggedOut && await page.clickExactText('去登录')
  const qr = login && await waitFor(`!!document.querySelector('[role="dialog"][aria-label="扫码登录"]')`, 5000)
  const confirmed = qr && await waitFor(
    `!!document.querySelector('[role="dialog"][aria-label="账号"]')`,
    12000,
  )
  const switched = confirmed && await waitFor(
    `document.querySelector('[data-following-directory]')?.dataset.followingAccount === '4381285' && document.querySelector('[data-following-directory]')?.dataset.followingLoaded === '60'`,
    20000,
  )
  const switchedRows = await rows()
  const switchedUnique = await unique()
  check(
    `旧账号的未完成分页不污染新账号 ${JSON.stringify({ count: switchedRows.length, mids: switchedUnique.mids })}`,
    switched && switchedUnique.count === 60 && switchedUnique.mids === 60 &&
      switchedRows.some((row) => row.text.includes('账号二专属')) &&
      !switchedRows.some((row) => row.text.includes('关注作者 319')),
  )

  check('打开的慢作品接口目录', await openFollowing({ spaceSlowMid: '5010' }))
  await waitFor(
    `document.querySelector('[data-following-directory]')?.dataset.followingLoaded === '320'`,
    10000,
  )
  await setInput('同名作者')
  await waitFor(`document.querySelectorAll('[data-following-author]').length === 2`)
  await page.evaluate(`document.querySelector('[data-following-author="5010"]')?.click()`)
  await sleep(120)
  await page.evaluate(`document.querySelector('[data-following-author="5300"]')?.click()`)
  const switchedAuthor = await waitFor(
    `document.querySelector('[data-following-preview]')?.dataset.authorMid === '5300' && document.querySelectorAll('[data-following-work]').length > 0`,
    10000,
  )
  await sleep(1600)
  const lateWork = await detail()
  check(
    `旧作者的作品响应不影响当前选中 ${JSON.stringify(lateWork)}`,
    switchedAuthor && lateWork.mid === '5300' && lateWork.works.every((mid) => mid === '5300'),
  )

  const newErrors = page.runtimeErrors.slice(startErrors)
  check(`关注目录没有控制台错误或未处理异常（${newErrors.length} 条）`, newErrors.length === 0)
  for (const error of newErrors) console.log(error)
}

async function checkShellBreakpoints(page) {
  await page.viewport(768, 800)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(5000)
  await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '曲库')
    hit?.click()
  })()`)
  await sleep(800)
  await page.evaluate(`(() => {
    const title = document.querySelector('#scroll-main button [title="深夜循环"]')
    title?.closest('button')?.click()
  })()`)
  await sleep(700)
  const played = await page.evaluate(`(() => {
    const row = document.querySelector('#scroll-main button[aria-label="播放 晴天"]')
    row?.click()
    return !!row
  })()`)
  await sleep(800)
  const measure = () =>
    page.evaluate(`(() => {
      const width = (selector) => document.querySelector(selector)?.getBoundingClientRect().width ?? 0
      return {
        viewport: innerWidth,
        main: width('#main-content'),
        sidebar: width('nav[aria-label="主导航"]'),
        rail: width('.rail-slot'),
        mobileNav: width('nav[aria-label="主要导航"]'),
        row: width('#scroll-main [data-row="track"] button.min-w-0.flex-1'),
        sheet: !!document.querySelector('[role="dialog"][aria-label="播放详情"]')?.getClientRects().length,
        sheetBody: width('[role="dialog"][aria-label="播放详情"] aside[aria-label="播放右栏"]'),
      }
    })()`)
  const middle = await measure()
  await page.evaluate(`document.querySelector('button[aria-label="歌词栏"]')?.click()`)
  await sleep(400)
  const middleOpen = await measure()
  await page.evaluate(
    `document.querySelector('[role="dialog"][aria-label="播放详情"] button[aria-label="关闭详情"]')?.click()`,
  )
  await sleep(300)
  await page.viewport(820, 800)
  await sleep(500)
  const narrowerMiddle = await measure()
  await page.evaluate(`document.querySelector('button[aria-label="歌词栏"]')?.click()`)
  await sleep(400)
  const narrowerOpen = await measure()
  await page.evaluate(
    `document.querySelector('[role="dialog"][aria-label="播放详情"] button[aria-label="关闭详情"]')?.click()`,
  )
  await sleep(300)
  await page.viewport(1024, 800)
  await sleep(500)
  const wideMiddle = await measure()
  await page.viewport(767, 800)
  await sleep(500)
  const narrow = await measure()
  await page.viewport(1280, 800)
  await sleep(500)
  await page.evaluate(`document.querySelector('button[aria-label="歌词栏"]')?.click()`)
  await sleep(500)
  const wide = await measure()
  await page.viewport(1024, 800)
  await sleep(500)
  const shrunk = await measure()
  check(
    '768 到 1279 收起右栏，播放列表保持可读',
    played &&
      middle.main >= 500 &&
      middle.row >= 160 &&
      !middle.sheet &&
      middleOpen.sheet &&
      middleOpen.sheetBody >= 760 &&
      narrowerMiddle.main >= 560 &&
      narrowerMiddle.row >= 220 &&
      narrowerOpen.sheetBody >= 800 &&
      wideMiddle.main >= 760 &&
      narrow.main >= 760 &&
      narrow.mobileNav >= 760 &&
      narrow.sidebar === 0 &&
      wide.rail === 320 &&
      wide.main < wideMiddle.main &&
      !wide.sheet &&
      shrunk.rail === 0 &&
      shrunk.main >= 760 &&
      !shrunk.sheet,
  )
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

/** 顶栏只留一个「哔哩哔哩网站」菜单；站内导航交给左栏或窄窗的同一个菜单。 */
async function checkTopbarSites(page) {
  const waitFor = async (expression, timeout = 6000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(100)
    }
    return false
  }
  const openMenu = async () => {
    const clicked = await page.evaluate(`(() => {
      const hit = document.querySelector('[data-site-menu-trigger]')
      hit?.click()
      return !!hit
    })()`)
    return clicked && await waitFor(`!!document.querySelector('[data-site-menu]')`)
  }
  const menuState = () =>
    page.evaluate(`(() => ({
      site: [...document.querySelectorAll('[data-site-menu] [data-site-kind]')]
        .map((el) => el.dataset.siteKind),
      ext: [...document.querySelectorAll('[data-site-menu] [data-site-url]')]
        .map((el) => el.dataset.siteUrl),
      focus: (document.activeElement?.textContent || '').trim(),
      focusKind: document.activeElement?.dataset.siteKind ?? '',
      focusUrl: document.activeElement?.dataset.siteUrl ?? '',
      trigger: document.querySelectorAll('[data-site-menu-trigger]').length,
      channelNav: document.querySelectorAll('nav[aria-label="频道"]').length,
      overflow: document.documentElement.scrollWidth - innerWidth,
    }))()`)
  const key = async (name, code, vk) => {
    await page.keyEvent({ type: 'keyDown', key: name, code, windowsVirtualKeyCode: vk })
    await page.keyEvent({ type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk })
    await sleep(120)
  }

  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(2500)
  const wideBefore = await menuState()
  const wideOpened = await openMenu()
  await sleep(120)
  const wideMenu = await menuState()
  check(
    '宽窗顶栏不再重复站内频道',
    wideBefore.trigger === 1 && wideBefore.channelNav === 0 && wideOpened,
  )
  check(
    '宽窗外链菜单四项且首项可键盘选择',
    wideMenu.site.length === 0 &&
      wideMenu.ext.length === 4 &&
      wideMenu.ext.includes('https://game.bilibili.com/') &&
      wideMenu.focus === '游戏中心',
  )
  await key('ArrowDown', 'ArrowDown', 40)
  const wideNext = await menuState()
  check('外链菜单方向键移动到下一项', wideNext.focus === '会员购')

  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="顶栏搜索"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '草稿')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await key('Escape', 'Escape', 27)
  const afterEsc = await page.evaluate(`({
    menu: !!document.querySelector('[data-site-menu]'),
    focus: document.activeElement?.hasAttribute('data-site-menu-trigger') === true,
    draft: document.querySelector('input[aria-label="顶栏搜索"]')?.value ?? '',
  })`)
  check(
    'Esc 关闭外链菜单并回到触发按钮，搜索草稿保留',
    !afterEsc.menu && afterEsc.focus && afterEsc.draft === '草稿',
  )

  await page.viewport(380, 820)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(2500)
  const narrowOpened = await openMenu()
  await sleep(120)
  const narrowMenu = await menuState()
  const narrowLayout = await page.evaluate(`(() => {
    const trigger = document.querySelector('[data-site-menu-trigger]')?.getBoundingClientRect()
    const form = document.querySelector('form')?.getBoundingClientRect()
    const message = document.querySelector('button[aria-label^="消息"]')?.getBoundingClientRect()
    return {
      triggerRight: trigger?.right ?? -1,
      formLeft: form?.left ?? -1,
      formRight: form?.right ?? -1,
      messageLeft: message?.left ?? -1,
    }
  })()`)
  check(
    '窄窗同一个菜单补上番剧与直播',
    narrowOpened &&
      narrowMenu.site.join(',') === 'bangumi,live' &&
      narrowMenu.ext.length === 4 &&
      narrowMenu.overflow <= 0,
  )
  check('窄窗网站菜单的六项均显示可加载的插画', await waitFor(`(() => {
    const items = [...document.querySelectorAll('[data-site-menu] [role="menuitem"]')]
    return items.length === 6 && items.every((item) => item.querySelector('img')?.naturalWidth > 0)
  })()`))
  check(
    '窄窗网站按钮与搜索框、消息入口不重叠',
    narrowLayout.triggerRight <= narrowLayout.formLeft + 1 &&
      narrowLayout.formRight <= narrowLayout.messageLeft + 1,
  )

  await page.evaluate(`document.querySelector('[data-site-kind="bangumi"]')?.click()`)
  const wentBangumi = await waitFor(`document.querySelector('h1')?.textContent?.trim() === '番剧'`, 8000)
  check('窄窗菜单可以进入番剧', narrowOpened && wentBangumi)

  const liveOpened = await openMenu()
  await page.evaluate(`document.querySelector('[data-site-kind="live"]')?.click()`)
  const wentLive = await waitFor(`document.querySelector('h1')?.textContent?.trim() === '直播'`, 8000)
  check('窄窗菜单可以进入直播', liveOpened && wentLive)

  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
}

/** 直播分页：第二页不能重复第一页的 room_id，列表里也不该出现重复 key。 */
async function checkLiveRooms(page) {
  const waitFor = async (expression, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(120)
    }
    return false
  }
  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1`)}`)
  await sleep(2200)
  const opened = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '直播') : null
    hit?.click()
    return !!hit
  })()`)
  const firstReady = opened && await waitFor(`!!document.querySelector('[data-live-hero]')`)
  const firstPage = await page.evaluate(`(() =>
    [...document.querySelectorAll('[data-live-hero],[data-live-room]')]
      .map((el) => Number(el.dataset.liveHero || el.dataset.liveRoom))
  )()`)
  await page.evaluate(`(() => {
    const box = document.getElementById('scroll-main')
    if (box) box.scrollTop = box.scrollHeight
  })()`)
  const loadedMore = await waitFor(
    `document.querySelectorAll('[data-live-hero],[data-live-room]').length >= 24`,
  )
  const allRooms = await page.evaluate(`(() =>
    [...document.querySelectorAll('[data-live-hero],[data-live-room]')]
      .map((el) => Number(el.dataset.liveHero || el.dataset.liveRoom))
  )()`)
  const unique = new Set(allRooms)
  check(
    '直播分页加载后 room_id 唯一，不再出现重复卡片',
    firstReady &&
      firstPage.length >= 12 &&
      loadedMore &&
      allRooms.length >= 24 &&
      unique.size === allRooms.length,
  )
  if (unique.size !== allRooms.length) console.log({ firstPage, allRooms })
}

/** 三连要等三项真实回执都确认后才报完成；这里用 mock 的关系状态验成功路径。 */
async function checkTriple(page) {
  const waitFor = async (expression, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(120)
    }
    return false
  }
  await page.viewport(1440, 900)
  const resetWatch = async (query = '') => {
    await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1${query}`)}`)
    const card = "document.querySelectorAll('[data-track-card]')[1]?.querySelector('button')"
    if (!await waitFor(`!!${card}`)) return false
    await page.evaluate(`${card}.click()`)
    return waitFor(`!!document.querySelector('.bili-tri-btn[aria-label="点赞"]')`)
  }
  const likePoint = () =>
    page.evaluate(`(() => {
      const box = document.querySelector('.bili-tri-like')?.closest('button')?.getBoundingClientRect()
      return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null
    })()`)
  const press = (point) =>
    page.mouseEvent({ type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  const release = (point) =>
    page.mouseEvent({ type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  const tripleState = () =>
    page.evaluate(`(() => ({
      like: document.querySelector('.bili-tri-btn[aria-label="取消点赞"]') !== null,
      coin: document.querySelector('.bili-tri-btn[aria-label="投币"]')?.getAttribute('aria-pressed') === 'true',
      fav: document.querySelector('.bili-tri-btn[aria-label="取消收藏"]') !== null,
      toast: document.body.innerText.includes('点赞、投币、收藏都已确认'),
      burst: document.querySelectorAll('.bili-tri-celebrate').length,
    }))()`)

  const shortReady = await resetWatch()
  const standalone = await page.evaluate(`!!document.querySelector('button[aria-label="一键三连"], [data-triple]')`)
  check('三连手势只占用点赞入口', shortReady && !standalone)
  const shortPoint = await likePoint()
  if (shortPoint) {
    await press(shortPoint)
    await sleep(180)
    await release(shortPoint)
  }
  await sleep(700)
  const shortState = await tripleState()
  check(
    '阈值前松手只点赞',
    shortReady && shortPoint && shortState.like && !shortState.coin && !shortState.fav && !shortState.toast,
  )

  const longReady = await resetWatch()
  const longPoint = await likePoint()
  if (longPoint) {
    await press(longPoint)
    await sleep(100)
    const charging = await page.evaluate(`document.querySelectorAll('.bili-tri-charge').length === 3 &&
      document.querySelectorAll('.bili-tri-celebrate').length === 0 &&
      !document.querySelector('.bili-tri-btn[aria-pressed="true"]')`)
    check('长按时三枚图标蓄力，未提交前不点亮', charging)
    await sleep(550)
    await release(longPoint)
  }
  const longConfirmed = await waitFor(
    `document.body.innerText.includes('点赞、投币、收藏都已确认')`,
  )
  const longState = await tripleState()
  check(
    '按住越过 550ms 触发三连，松手不会取消点赞',
    longReady && longPoint && longConfirmed && longState.like && longState.coin && longState.fav && longState.burst === 3,
  )

  const cancelReady = await resetWatch()
  const cancelPoint = await likePoint()
  if (cancelPoint) {
    await press(cancelPoint)
    await sleep(80)
    await page.mouseEvent({ type: 'mouseMoved', x: 800, y: 220, button: 'none', buttons: 1 })
    await sleep(650)
    await release({ x: 800, y: 220 })
  }
  await sleep(700)
  const cancelState = await tripleState()
  check(
    '按住移出后松手不提交任何互动',
    cancelReady && cancelPoint && !cancelState.like && !cancelState.coin && !cancelState.fav && !cancelState.toast,
  )

  const changedReady = await resetWatch()
  const changed = await page.evaluate(`(() => {
    const like = document.querySelector('.bili-tri-btn[aria-label="点赞"]')
    const next = document.querySelector('[data-related-item]')
    like?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    next?.click()
    return !!like && !!next
  })()`)
  await sleep(900)
  const changedToast = await page.evaluate(
    `document.body.innerText.includes('点赞、投币、收藏都已确认')`,
  )
  check('按住时换稿取消本次三连', changedReady && changed && !changedToast)

  const failReady = await resetWatch('&failCoin=1')
  const counts = () => page.evaluate(`[...document.querySelectorAll('.bili-tri-btn')].map(el => Number(el.textContent.trim()))`)
  const beforeFail = await counts()
  const failPoint = await likePoint()
  if (failPoint) {
    await press(failPoint)
    await sleep(650)
    await release(failPoint)
  }
  const partial = await waitFor(
    `document.body.innerText.includes('未确认：投币') && document.body.innerText.includes('已确认：点赞、收藏')`,
  )
  const failed = await tripleState()
  check('投币失败只保留点赞、收藏；不播放三连动效', failReady && partial &&
    failed.like && !failed.coin && failed.fav && !failed.toast && failed.burst === 0)

  const afterFail = await counts()
  check('部分成功的点赞和收藏数字随回执增加', afterFail[0] === beforeFail[0] + 1 &&
    afterFail[1] === beforeFail[1] && afterFail[2] === beforeFail[2] + 1)

  await page.evaluate(`history.replaceState(null, '', ${JSON.stringify(`${WEB}?loggedIn=1`)})`)
  const retryPoint = await likePoint()
  if (retryPoint) {
    await press(retryPoint)
    await sleep(650)
    await release(retryPoint)
  }
  const recovered = await waitFor(`document.body.innerText.includes('点赞、投币、收藏都已确认')`)
  const afterRetry = await counts()
  check('重试只补缺少的两枚币', recovered && afterRetry[0] === afterFail[0] &&
    afterRetry[1] === afterFail[1] + 2 && afterRetry[2] === afterFail[2])

  const oneCoinReady = await resetWatch()
  const beforeCoin = await counts()
  await page.evaluate(`document.querySelector('.bili-tri-btn[aria-label="投币"]').click()`)
  await page.clickExactText('投 1 枚')
  await waitFor(`!!document.querySelector('.bili-tri-btn[aria-label="取消点赞"]')`)
  const afterCoin = await counts()
  check('投一枚并同时点赞后，两项数字同步增加', oneCoinReady &&
    afterCoin[0] === beforeCoin[0] + 1 && afterCoin[1] === beforeCoin[1] + 1)
  const topUpPoint = await likePoint()
  if (topUpPoint) {
    await press(topUpPoint)
    await sleep(650)
    await release(topUpPoint)
  }
  const toppedUp = await waitFor(`document.body.innerText.includes('点赞、投币、收藏都已确认')`)
  const afterTopUp = await counts()
  check('已投一枚时三连只补一枚', toppedUp && afterTopUp[0] === afterCoin[0] &&
    afterTopUp[1] === afterCoin[1] + 1 && afterTopUp[2] === afterCoin[2] + 1)

  const keyboardReady = await resetWatch()
  await page.evaluate(`document.querySelector('.bili-tri-btn[aria-label="点赞"]').focus()`)
  await page.pressSpace()
  const keyboardShort = await waitFor(`!!document.querySelector('.bili-tri-btn[aria-label="取消点赞"]')`)
  const onlyLiked = await tripleState()
  check('聚焦点赞后轻按空格只点赞', keyboardReady && keyboardShort && !onlyLiked.coin && !onlyLiked.fav)
  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
  await page.keyEvent({ ...enter, type: 'keyDown' })
  await sleep(120)
  const still = await page.evaluate(`getComputedStyle(document.querySelector('.bili-tri-charge circle')).animationName === 'none'`)
  await page.keyEvent({ ...enter, type: 'keyDown', autoRepeat: true })
  const keyConfirmed = await waitFor(`document.body.innerText.includes('点赞、投币、收藏都已确认')`)
  await page.keyEvent({ ...enter, type: 'keyUp' })
  const afterKey = await tripleState()
  check('按住回车触发三连，按键重复和松开不反转', keyConfirmed && afterKey.like && afterKey.coin && afterKey.fav)
  const reducedBurst = await page.evaluate(`[...document.querySelectorAll('.bili-tri-celebrate')]
    .every(el => getComputedStyle(el).animationName === 'none' && getComputedStyle(el, '::after').animationName === 'none')`)
  check('减少动态效果时保留按住提示和完成状态', still && afterKey.burst === 3 && reducedBurst)
  await page.emulateMedia([])
}

/** 榜单首屏骨架必须和真实首行同起点，页首和分区在数据到达前后不跳。 */
async function checkRankingSkeleton(page) {
  const waitFor = async (expression, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(80)
    }
    return false
  }
  const geometry = () =>
    page.evaluate(`(() => {
      const header = document.querySelector('[data-hot-page="ranking"]')
      const group = header?.querySelector('[role="group"]')
      const first = document.querySelector('[data-rank-skeleton], [data-rank-row]')
      return {
        headerBottom: Math.round(header?.getBoundingClientRect().bottom ?? -1),
        segmentTop: Math.round(group?.getBoundingClientRect().top ?? -1),
        firstTop: Math.round(first?.getBoundingClientRect().top ?? -1),
        focus: (document.activeElement?.textContent || '').trim(),
        skeletonTabs: document.querySelectorAll('[data-rank-skeleton] button, [data-rank-skeleton] [tabindex]').length,
      }
    })()`)

  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1&slowRanking=1`)}`)
  await sleep(2200)
  const clicked = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '排行榜') : null
    hit?.focus()
    return document.activeElement === hit
  })()`)
  if (clicked) await page.pressSpace()
  const skeletonReady = clicked && await waitFor(`!!document.querySelector('[data-rank-skeleton]')`, 1200)
  const before = await geometry()
  const loaded = await waitFor(`document.querySelectorAll('[data-rank-row]').length >= 9`, 6000)
  const after = await geometry()
  const ok =
    skeletonReady &&
    loaded &&
    before.skeletonTabs === 0 &&
    before.focus === '排行榜' &&
    before.headerBottom === after.headerBottom &&
    before.segmentTop === after.segmentTop &&
    Math.abs(before.firstTop - after.firstTop) <= 1
  check('榜单首屏骨架与真实首行同起点，页首和分区不跳', ok)
  if (!ok) console.log({ skeletonReady, loaded, before, after })
}

/** 热门第二页失败时保留已加载卡片，原地重试只追加一次，不跳回顶部。 */
async function checkPopularPaging(page) {
  const waitFor = async (expression, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(100)
    }
    return false
  }
  const state = () =>
    page.evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-wide-card]')]
      const box = document.getElementById('scroll-main')
      const retry = [...document.querySelectorAll('#scroll-main button')]
        .find((button) => (button.textContent || '').trim() === '重试')
      return {
        count: cards.length,
        keys: [...new Set(cards.map((card) => card.getAttribute('data-wide-card')))],
        error: document.body.innerText.includes('预览：热门第二页失败'),
        retry: !!retry,
        scrollTop: Math.round(box?.scrollTop ?? -1),
        first: cards[0]?.getAttribute('data-wide-card') ?? '',
      }
    })()`)

  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1&popularFailOnce=1`)}`)
  await sleep(2200)
  const clicked = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '综合热门') : null
    hit?.click()
    return !!hit
  })()`)
  const firstReady = clicked && await waitFor(`document.querySelectorAll('[data-wide-card]').length === 20`)
  await page.evaluate(`(() => {
    const box = document.getElementById('scroll-main')
    if (box) box.scrollTop = box.scrollHeight
  })()`)
  const failed = await waitFor(`document.body.innerText.includes('预览：热门第二页失败')`)
  const failedState = await state()
  const retried = failed && await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('#scroll-main button')]
      .find((button) => (button.textContent || '').trim() === '重试')
    hit?.click()
    return !!hit
  })()`)
  const appended = await waitFor(`document.querySelectorAll('[data-wide-card]').length === 40`)
  const finalState = await state()
  check(
    '热门下一页失败保留已有卡片，原地重试只追加一次且不回到顶部',
    firstReady &&
      failed &&
      failedState.count === 20 &&
      failedState.error &&
      failedState.retry &&
      retried &&
      appended &&
      finalState.count === 40 &&
      finalState.keys.length === 40 &&
      finalState.first === failedState.first &&
      finalState.scrollTop > 0 &&
      !finalState.error,
  )
  if (!appended || finalState.count !== 40) console.log({ failedState, finalState })
}

/** 真正空的曲库用完整 2233 空态和新建入口；窄窗不横向溢出。 */
async function checkLibraryEmpty(page) {
  const waitFor = async (expression, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(120)
    }
    return false
  }
  const state = () =>
    page.evaluate(`(() => {
      const button = [...document.querySelectorAll('#scroll-main button')]
        .find((el) => (el.textContent || '').trim() === '新建歌单')
      return {
        empty: !!document.querySelector('#scroll-main img[src$="/assets/2233.png"]'),
        button: !!button,
        visible: (button?.getClientRects().length ?? 0) > 0,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }
    })()`)

  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1&libraryEmpty=1`)}`)
  await sleep(2200)
  let opened = false
  for (let i = 0; i < 30 && !opened; i += 1) {
    await sleep(200)
    opened = await page.clickText('曲库')
  }
  const emptyReady = opened && await waitFor(`document.body.innerText.includes('还没有歌单')`)
  const wide = await state()
  const modalOpened = emptyReady && await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('#scroll-main button')]
      .find((el) => (el.textContent || '').trim() === '新建歌单')
    hit?.click()
    return !!hit
  })()`)
  const inputReady = modalOpened && await waitFor(`!!document.querySelector('input[placeholder="给歌单起个名字"]')`)
  await page.keyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.keyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(200)

  await page.viewport(380, 820)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1&libraryEmpty=1`)}`)
  await sleep(2200)
  const narrowOpened = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主要导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '曲库') : null
    hit?.click()
    return !!hit
  })()`)
  const narrowReady = narrowOpened && await waitFor(`document.body.innerText.includes('还没有歌单')`)
  const narrow = await state()
  const ok =
    emptyReady &&
    wide.empty &&
    wide.button &&
    wide.visible &&
    inputReady &&
    narrowReady &&
    narrow.empty &&
    narrow.button &&
    narrow.visible &&
    narrow.overflow <= 0
  check('空曲库使用完整空态与新建入口，窄窗不溢出', ok)
  if (!ok) console.log({ emptyReady, inputReady, narrowReady, wide, narrow })
}

/** 「我的」是个人中心，设置是次级页；宽窄窗都能回到原层级。 */
async function checkProfileSettings(page) {
  const waitFor = async (expression, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return true
      await sleep(120)
    }
    return false
  }
  const profileState = () =>
    page.evaluate(`(() => ({
      account: !!document.querySelector('[data-profile-account]'),
      services: document.querySelectorAll('[data-profile-service]').length,
      settings: !!document.querySelector('[data-profile-settings]'),
      heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    }))()`)
  const settingsState = () =>
    page.evaluate(`(() => {
      const section = (title) => [...document.querySelectorAll('section')]
        .find((node) => node.querySelector('h2')?.textContent === title)
      return {
        heading: document.querySelector('h1')?.textContent?.trim() ?? '',
        playTop: Math.round(section('播放')?.getBoundingClientRect().top ?? -1),
        shortcutTop: Math.round(section('快捷键')?.getBoundingClientRect().top ?? -1),
        shortcutVisible: (section('快捷键')?.getClientRects().length ?? 0) > 0,
        switches: document.querySelectorAll('section [role="switch"]').length,
      }
    })()`)
  const openMine = async () => {
    const ok = await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主要导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '我的') : null
      hit?.click()
      return !!hit
    })()`)
    return ok && await waitFor(`!!document.querySelector('[data-profile-account]')`)
  }
  const backToProfile = async () => {
    const ok = await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主要导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '我的') : null
      hit?.click()
      return !!hit
    })()`)
    return ok && await waitFor(`!!document.querySelector('[data-profile-account]')`)
  }

  await page.viewport(380, 820)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1`)}`)
  await sleep(2200)
  const mineOpened = await openMine()
  const profile = await profileState()
  check(
    '窄窗「我的」进入个人中心',
    mineOpened && profile.account && profile.services === 6 && profile.settings && profile.heading === '我的',
  )

  check('个人中心与侧栏六个同名入口复用同一张可加载的图', await waitFor(`(() => {
    const services = [...document.querySelectorAll('[data-profile-service]')]
    const sidebar = [...document.querySelectorAll('nav[aria-label="主导航"] button')]
    return services.length === 6 && services.every((service) => {
      const label = service.textContent.trim()
      const link = sidebar.find((button) => (button.getAttribute('aria-label') || button.textContent.trim()) === label)
      const icon = service.querySelector('img')
      return icon?.naturalWidth > 0 && icon.currentSrc === link?.querySelector('img')?.currentSrc
    })
  })()`))

  const settingsClicked = await page.evaluate(`(() => {
    const hit = document.querySelector('[data-profile-settings]')
    hit?.click()
    return !!hit
  })()`)
  const settingsReady = settingsClicked && await waitFor(`document.querySelector('h1')?.textContent?.trim() === '设置'`)
  const narrowSettings = await settingsState()
  check(
    '设置的播放开关在窄窗首屏，快捷键不在前面',
    settingsReady && narrowSettings.switches >= 2 && narrowSettings.playTop > 0 && !narrowSettings.shortcutVisible,
  )
  if (!(settingsReady && narrowSettings.switches >= 2 && narrowSettings.playTop > 0)) {
    console.log({ settingsReady, narrowSettings })
  }
  const backProfile = await backToProfile()
  check('从设置返回仍在个人中心', backProfile)
  if (!backProfile) console.log({ step: 'back-settings', backProfile })

  const favsClicked = await page.evaluate(`(() => {
    const hit = document.querySelector('[data-profile-service="favs"]')
    hit?.click()
    return !!hit
  })()`)
  const favsReady = favsClicked && await waitFor(`document.querySelector('h1')?.textContent?.trim() === '收藏夹'`)
  const backFromFavs = await backToProfile()
  check('从收藏夹返回仍在个人中心', favsReady && backFromFavs)
  if (!favsReady || !backFromFavs) console.log({ step: 'back-favs', favsReady, backFromFavs })

  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(1800)
  const unloggedOpened = await openMine()
  const unlogged = await page.evaluate(`document.body.innerText.includes('未登录') && document.body.innerText.includes('扫码登录')`)
  const authOpened = unloggedOpened && await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '扫码登录')
    hit?.click()
    return !!hit
  })()`)
  await page.keyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.keyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  const stillProfile = await page.evaluate(`!!document.querySelector('[data-profile-account]')`)
  check('未登录个人中心可打开登录，取消后仍在原页', unloggedOpened && unlogged && authOpened && stillProfile)

  await page.viewport(1440, 900)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?loggedIn=1`)}`)
  await sleep(1800)
  const desktopProfile = await page.evaluate(`(() => {
    const nav = document.querySelector('nav[aria-label="主导航"]')
    const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '个人中心') : null
    hit?.click()
    return !!hit
  })()`)
  const desktopReady = desktopProfile && await waitFor(`!!document.querySelector('[data-profile-account]')`)
  await page.evaluate(`document.querySelector('[data-profile-settings]')?.click()`)
  const desktopSettingsReady = await waitFor(`document.querySelector('h1')?.textContent?.trim() === '设置'`)
  const desktopSettings = await settingsState()
  check(
    '宽窗个人中心与设置入口稳定，快捷键在播放之后',
    desktopReady && desktopSettingsReady && desktopSettings.playTop > 0 &&
      desktopSettings.shortcutVisible && desktopSettings.shortcutTop > desktopSettings.playTop,
  )
  await page.viewport(1320, 900)
}

function watchUiWait(page) {
  return async (expression) => {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (await page.evaluate(`Boolean(${expression})`)) return true
      await sleep(50)
    }
    throw new Error(`观看页验收超时：${expression}`)
  }
}

async function checkWatchPartHistory(page) {
  const waitFor = watchUiWait(page)
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?watchHistory=1`)}`)
  const input = `document.querySelector('[aria-label="顶栏搜索"]')`
  await waitFor(`location.search.includes('watchHistory') && ${input} && window.shaka?.Player`)
  await page.evaluate(`(() => {
    // 预览的 MPD 没有媒体流。只代替网络加载，保留实际的播放器与视频定位。
    window.shaka.Player.prototype.load = async () => {}
    const input = ${input}
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '晴天')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.requestSubmit()
  })()`)
  const card = "document.querySelector('[data-search-results] [data-track-title=\"晴天\"]')"
  const watch = `${card}.querySelector('[aria-label=\"观看 晴天\"]')`
  await waitFor(card)
  const key = await page.evaluate(`${card}.dataset.key`)
  const keys = [
    `oh-bilibili:watch-page:${key}`, `oh-bilibili:page-count:${key}`,
    ...[1, 2, 3].flatMap(no => [`oh-bilibili:watch-pos:${key}:${no}`, `oh-bilibili:watch-len:${key}:${no}`]),
  ]
  const local = await page.evaluate(`${JSON.stringify(keys)}.map(key => localStorage.getItem(key))`)
  const active = `document.querySelector('[data-watch-pages] button[aria-pressed=true]')?.innerText`
  const restored = `${active}?.includes('P2') && document.body.innerText.includes('上次观看位置 1:17') && document.querySelector('video')?.currentTime === 77`
  try {
    await page.evaluate(`${JSON.stringify(keys)}.forEach(key => localStorage.removeItem(key))`)
    await page.evaluate(`${watch}.click()`)
    check('搜索卡无本地断点时打开数据库记录的 P2，画面回到 1:17', await waitFor(restored))
    await page.evaluate(`document.querySelector('button[aria-label="返回"]').click()`)
    await waitFor(card)
    await page.evaluate(`(() => {
      const input = ${input}
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify('https://www.bilibili.com/video/' + key + '?p=1')})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    })()`)
    check('显式 P1 链接从 0:00 开始，不沿用 P2 的续播时间', await waitFor(
      `window.__ohBilibiliWatch?.state().ready && ${active}?.includes('P1') && document.querySelector('video')?.currentTime === 0 && !document.body.innerText.includes('上次观看位置 1:17')`))
    await page.evaluate(`document.querySelector('button[aria-label="返回"]').click()`)
    await waitFor(card)
    await page.evaluate(`(() => {
      localStorage.setItem(${JSON.stringify(keys[0])}, '3')
      localStorage.setItem(${JSON.stringify(`oh-bilibili:watch-pos:${key}:3`)}, '8000')
      ${watch}.click()
    })()`)
    check('本地留有 P3 的 0:08 时，搜索卡仍恢复数据库 P2 的 1:17', await waitFor(restored))
  } finally {
    await page.evaluate(`${JSON.stringify(keys)}.forEach((key, i) => {
      const value = ${JSON.stringify(local)}[i]
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    })`)
  }
}

async function checkWatchLink(page) {
  const waitFor = watchUiWait(page)
  await page.viewport(1320, 900)
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?commentJumps=1`)}`)
  const input = `document.querySelector('[aria-label="顶栏搜索"]')`
  await waitFor(`location.search.includes('commentJumps') && ${input}`)
  const submit = async (text, action) => {
    await page.evaluate(`(() => {
      const input = ${input}
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    const button = `${input}.form.querySelector('button[type="submit"]')`
    await waitFor(`${button}.textContent === ${JSON.stringify(action)} && !${button}.disabled`)
    await page.evaluate(`${button}.click()`)
  }
  await submit('晴天', '搜索')
  const result = "document.querySelector('[data-search-results] [data-track-card]')"
  check('普通搜索词仍展示视频结果', await waitFor(`${result}?.dataset.trackTitle?.includes('晴天')`))

  const key = await page.evaluate(`${result}.dataset.key`)
  const link = `https://www.bilibili.com/video/${key}?p=2&t=77`
  const last = "performance.getEntriesByName('comment-page-ready').at(-1)?.detail"
  const activePart = "document.querySelector('[data-watch-pages] button[aria-pressed=true]')?.innerText"
  const target = `${activePart}?.includes('P2') && ${last}?.page === 2 && ${last}?.at === 77000`
  await submit(link, '打开视频')
  check('顶栏分享链接打开 P2 并向播放引擎传入 1:17', await waitFor(target))

  await page.evaluate(`document.querySelector('[data-watch-pages] ol button').click()`)
  await waitFor(`${activePart}?.includes('P1') && ${last}?.page === 1`)
  await submit(link, '打开视频')
  check('手动切到 P1 后重贴同一链接，回到 P2 的 1:17', await waitFor(target))
}

async function checkCommentPauseIntent(page) {
  await page.evaluate(`location.href = ${JSON.stringify(`${WEB}?commentJumps=1`)}`)
  const waitFor = watchUiWait(page)
  await waitFor('location.search.includes("commentJumps") && !!document.querySelector("main h2")')
  await page.evaluate(`Promise.all([import('/src/app/appStore.ts'), import('/src/shared/lib/mockCatalog.ts')])
    .then(([app, catalog]) => app.useAppStore.getState().navigate({ kind: 'watch', track: catalog.CATALOG[0], page: 1 }))`)
  const buttons = `[...document.querySelectorAll('[data-comment-id="1"] button')]`
  await waitFor(`${buttons}.some(button => button.textContent === 'P2 03:20')`)
  const seek = (p) => page.evaluate(`${buttons}.find(button => button.textContent === 'P${p} 03:20').click()`)
  const storeUrl = await page.evaluate(`performance.getEntriesByType('resource').find(entry =>
    new URL(entry.name).pathname === '/src/features/player/playerStore.ts')?.name`)
  const setPhase = (phase) => page.evaluate(`import(${JSON.stringify(storeUrl)}).then(m => {
    const player = m.usePlayerStore.getState()
    player.applySnapshot({ ...player.snapshot, phase: ${JSON.stringify(phase)} })
  })`)
  const last = "performance.getEntriesByName('comment-page-ready').at(-1)?.detail"
  await setPhase('paused')
  await seek(2)
  await waitFor(`${last}?.page === 2`)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await setPhase('loading')
  await seek(1)
  await waitFor(`${last}?.page === 1`)
  check('清单已返回、音轨仍在加载时，第二次切 P 保持暂停', await page.evaluate(`${last}.paused === true`))

  await setPhase('playing')
  await seek(2)
  await waitFor(`${last}?.page === 2`)
  check('音轨就绪后恢复播放，再切 P 延续播放', await page.evaluate(`${last}.paused === false`))
}

async function main() {
  if (!existsSync(CHROME)) {
    if (libraryPartialOnly || process.argv.includes('--typography-only') || process.argv.includes('--social-only') || process.argv.includes('--space-catalog-only')) throw new Error(`找不到 Chrome：${CHROME}`)
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
    if (process.argv.includes('--space-catalog-only')) {
      const { checkSpaceCatalog } = await import('./space-catalog-smoke.mjs')
      await checkSpaceCatalog(page, WEB, watchUiWait(page), check)
      return
    }
    if (process.argv.includes('--social-only')) {
      const { checkSocialPages } = await import('./social-smoke.mjs')
      await checkSocialPages(page, WEB, watchUiWait(page), check)
      return
    }
    if (process.argv.includes('--typography-only')) {
      const { checkTypography } = await import('./typography-smoke.mjs')
      await checkTypography(page, WEB, watchUiWait(page), check)
      return
    }
    if (process.argv.includes('--discovery-only')) {
      await checkDiscoveryFeed(page)
      await checkHeroAllocation(page)
      await checkNavConventions(page)
      return
    }
    if (process.argv.includes('--watch-link-only')) {
      await checkWatchLink(page)
      return
    }
    if (process.argv.includes('--comment-pause-only')) {
      await checkCommentPauseIntent(page)
      return
    }
    if (process.argv.includes('--watch-history-only')) {
      await checkWatchPartHistory(page)
      return
    }
    if (process.argv.includes('--history-parts-only')) {
      await checkHistoryParts(page)
      return
    }
    if (process.argv.includes('--stage-moments-only')) {
      await checkStageMoments(page)
      return
    }
    if (channelOnly) {
      await checkChannelNav(page)
      return
    }
    if (topbarOnly) {
      await checkTopbarSites(page)
      return
    }
    if (liveOnly) {
      await checkLiveRooms(page)
      return
    }
    if (tripleOnly) {
      await checkTriple(page)
      return
    }
    if (rankingSkeletonOnly) {
      await checkRankingSkeleton(page)
      return
    }
    if (popularPagingOnly) {
      await checkPopularPaging(page)
      return
    }
    if (libraryEmptyOnly) {
      await checkLibraryEmpty(page)
      return
    }
    if (profileOnly) {
      await checkProfileSettings(page)
      return
    }
    if (followingOnly) {
      await checkFollowingDirectory(page)
      return
    }
    await checkLibraryPartial(page)
    if (libraryPartialOnly) return
    await checkWatchLink(page)
    await checkCommentPauseIntent(page)
    await checkLibraryShelf(page)
    await checkStageLyrics(page)
    await checkStageMoments(page)
    await checkStageMorph(page)
    await checkHeroAllocation(page)
    await checkAuthorSpace(page)
    await checkTopbarSites(page)
    await checkLiveRooms(page)
    await checkTriple(page)
    await checkFollowingDirectory(page)
    await checkDiscoveryFeed(page)
    await checkHistoryParts(page)
    await checkWatchPartHistory(page)
    await checkNavConventions(page)
    await checkRanking(page)
    await checkRankingSkeleton(page)
    await checkPopularPaging(page)
    await checkLibraryEmpty(page)
    await checkProfileSettings(page)
    await checkChannelNav(page)
    await checkRailScope(page)
    await checkShellBreakpoints(page)
    await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
    if (DYNAMIC_RETURN) {
      await dynamicReturn(page)
      if (checks.some((c) => !c.ok)) process.exitCode = 1
      return
    }
    await sleep(6000)

    const readBarButton = (label) => page.evaluate(`(() => {
      const element = [...document.querySelectorAll('.safe-top button')].find(
        (button) => button.textContent.trim() === ${JSON.stringify(label)},
      )
      if (!element) return null
      let surface = element
      while (surface.parentElement && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') {
        surface = surface.parentElement
      }
      const box = element.getBoundingClientRect()
      return {
        color: getComputedStyle(element).color,
        background: getComputedStyle(surface).backgroundColor,
        center: [box.left + box.width / 2, box.top + box.height / 2],
      }
    })()`)
    const labels = ['搜索', '投稿', '登录']
    const primaryButtons = await Promise.all(labels.map(readBarButton))
    check(
      '顶栏按钮文字在实际背景上达到 4.5:1',
      primaryButtons.every(
        (button) => button && contrastRatio(button.color, button.background) >= 4.5,
      ),
    )
    for (const [i, button] of primaryButtons.entries()) {
      if (!button) continue
      await page.mouseEvent({ type: 'mouseMoved', x: button.center[0], y: button.center[1] })
      await sleep(250)
      const hovered = await readBarButton(labels[i])
      check(
        `${labels[i]}悬停时仍达到 4.5:1`,
        hovered && contrastRatio(hovered.color, hovered.background) >= 4.5,
      )
    }
    await page.mouseEvent({ type: 'mouseMoved', x: 4, y: 4 })
    const loginFocus = await page.evaluate(`(() => {
      const login = [...document.querySelectorAll('button')].find(
        (button) => (button.textContent || '').trim() === '登录',
      )
      login?.focus()
      if (!login) return null
      const style = getComputedStyle(login)
      return {
        focusVisible: login.matches(':focus-visible'),
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        background: getComputedStyle(document.body).backgroundColor,
      }
    })()`)
    check(
      '登录按钮键盘焦点环清晰',
      loginFocus &&
        loginFocus.focusVisible &&
        Number.parseFloat(loginFocus.outlineWidth) >= 2 &&
        contrastRatio(loginFocus.outlineColor, loginFocus.background) >= 3,
    )

    const heroAuthor = await page.evaluate(`(() => {
      const card = document.querySelector('[data-home-hero-grid] > div')
      const authorRow = card?.querySelector('[data-focus-id^="hero-author:"], span[title]')
      const coverStats = card?.querySelector('button[data-focus-id^="herocard:"] > span')
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
        `[...document.querySelectorAll('h3')].some((el) => el.textContent.trim() === '本集章节' && el.getClientRects().length > 0)`,
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
        const dialog = document.querySelector('[data-search-results]')
        return !!dialog && dialog.querySelectorAll('[data-track-card]').length > 0
      })()`)
    }
    check('顶栏搜索提交后出结果', submitted && searched)
    const singleResult = await page.evaluate(`(() => {
      const dialog = document.querySelector('[data-search-results]')
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
      const dialog = document.querySelector('[data-search-results]')
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      const active = document.activeElement
      return {
        dialog: !!dialog,
        query: input ? input.value : '',
        focused: !!active?.closest?.('[data-track-card]'),
        scrollTop: dialog?.scrollTop,
      }
    })()`)
    check('从作品返回原搜索页', searchVideo && returned.dialog && returned.query === '晴天')
    check('返回后焦点落回结果卡片', returned.focused)
    check(
      `单条结果返回原位置（${singleResult?.scrollTop} → ${returned.scrollTop}）`,
      singleResult?.count === 1 && returned.scrollTop === singleResult.scrollTop,
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
      const dialog = document.querySelector('[data-search-results]')
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      return {
        dialog: !!dialog,
        query: input ? input.value : '',
        focused: !!document.activeElement?.closest?.('[data-track-card]'),
      }
    })()`)
    check(
      'Esc 收联想后返回仍回结果页与原卡片',
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
      resultCount = await page.evaluate(`document.querySelectorAll('[data-search-results] [data-track-card]').length`)
    }

    const filters = ['音乐', '最多播放', '10 分钟以下']
    const filtersSelected = await page.evaluate(`(() => {
      const dialog = document.querySelector('[data-search-results]')
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      return ${JSON.stringify(filters)}.every((label) => {
        const button = buttons.find((button) => button.textContent.trim() === label)
        button?.click()
        return !!button
      })
    })()`)
    await sleep(1200)
    const manyResults = await page.evaluate(`(() => {
      const dialog = document.querySelector('[data-search-results]')
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
      const dialog = document.querySelector('[data-search-results]')
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
    await page.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '尚未提交的词')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await page.evaluate(`document.querySelector('button[aria-label="清空搜索"]')?.click()`)
    check('清空草稿保留已提交的结果与阅读位置', await page.evaluate(`(() => {
      const results = document.querySelector('[data-search-results]')
      const input = document.querySelector('input[aria-label="顶栏搜索"]')
      const query = results?.querySelector('.search-committed-query')
      const card = results?.querySelectorAll('[data-track-card]')[2]?.querySelector('button[aria-label^="观看"]')
      return input?.value === '' && document.activeElement === input &&
        query?.getBoundingClientRect().width > 0 && query.innerText === '「周杰伦」的搜索结果' &&
        card?.getAttribute('aria-label') === ${JSON.stringify(manyResults?.focused)} &&
        results.scrollTop === ${returnedMany.scrollTop}
    })()`))
    await page.evaluate(`[...document.querySelectorAll('[data-search-results] button')].find(b => b.textContent.trim() === '返回')?.click()`)
    check(
      '主动关闭搜索后露出原页面',
      await page.evaluate(`!document.querySelector('[data-search-results]') && !!document.querySelector('[data-home-recommend]')`),
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
      const panel = [...document.querySelectorAll('[data-watch-pages]')].find((el) => el.getClientRects().length > 0)
      const p2 = [...(panel?.querySelectorAll('ol li button') ?? [])].find((b) =>
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
    const matchingPart = `${visiblePanel}?.querySelector('ol button[title="晴天 · 现场版"]')`
    await watchUiWait(page)(matchingPart)
    await page.evaluate(`${matchingPart}.click()`)
    let picked = await page.evaluate(pageRows)
    for (let i = 0; i < 80 && !picked.header.includes('P62/80'); i += 1) {
      await sleep(100)
      picked = await page.evaluate(pageRows)
    }
    check('选中筛选结果才切到 P62', picked.header.includes('P62/80'))
    await page.evaluate(`${visiblePanel}?.querySelector('button[aria-label="清除筛选"]')?.click()`)
    await sleep(300)
    const cleared = await page.evaluate(pageRows)
    check(
      '清除筛选恢复 80 集并保留当前项标记',
      cleared.count === 80 && cleared.active.includes('P62'),
    )

    // 目录：右栏首位、行内进度、当前集定位，以及中等窗口的同一个面板。
    await page.viewport(1320, 900)
    await sleep(500)
    const railDirectory = await page.evaluate(`(() => {
      const rail = document.querySelector('[data-watch-rail]')
      const panel = [...document.querySelectorAll('[data-watch-pages]')].find((el) => el.getClientRects().length > 0)
      const first = rail?.firstElementChild
      const rows = panel ? [...panel.querySelectorAll('ol li')] : []
      const current = rows.find((row) => row.querySelector('button[aria-pressed="true"]'))
      const title = rows[0]?.querySelector('button > span:nth-child(2)')
      return {
        firstIsDirectory: !!panel && first === panel,
        header: panel?.querySelector('h3')?.parentElement?.textContent?.trim() ?? '',
        rows: rows.length,
        currentText: current?.textContent?.trim() ?? '',
        currentIcon: !!current?.querySelector('svg'),
        chapters: [...document.querySelectorAll('h3')].map((h) => (h.textContent || '').trim()),
        wraps: title ? getComputedStyle(title).whiteSpace !== 'nowrap' : false,
      }
    })()`)
    check(
      '右栏第一块是分 P 目录，标题带当前集与总数',
      railDirectory.firstIsDirectory &&
        railDirectory.rows === 80 &&
        railDirectory.header.includes('本视频分 P') &&
        railDirectory.header.includes('P62/80'),
    )
    check(
      '当前集有选中态和播放图标，标题按行换行',
      railDirectory.currentText.includes('P62') && railDirectory.currentIcon && railDirectory.wraps,
    )
    check('章节标题标明是本集内的时间点', railDirectory.chapters.includes('本集章节'))

    await page.viewport(1000, 900)
    await sleep(600)
    const pagePicker = `[...document.querySelectorAll('#scroll-main button[aria-haspopup="dialog"]')]
      .find(button => button.textContent.trim().startsWith('选集 ·'))`
    const pickerEntry = await page.evaluate(`(() => {
      const hit = ${pagePicker}
      return hit && hit.getClientRects().length > 0 ? hit.textContent.trim() : null
    })()`)
    check('中等窗口在播放器下方保留选集入口', !!pickerEntry && pickerEntry.includes('选集 · P62/80'))
    await page.evaluate(`${pagePicker}?.click()`)
    await sleep(500)
    const sheet = await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="选集"]')
      const panel = dialog?.querySelector('[data-watch-pages]')
      const list = panel?.querySelector('ol')
      const current = panel?.querySelector('li button[aria-pressed="true"]')
      const listBox = list?.getBoundingClientRect()
      const currentBox = current?.getBoundingClientRect()
      return {
        title: dialog?.getAttribute('aria-label') ?? '',
        rows: panel?.querySelectorAll('ol li').length ?? 0,
        inView: !!(
          listBox &&
          currentBox &&
          currentBox.top >= listBox.top - 1 &&
          currentBox.bottom <= listBox.bottom + 1
        ),
        onlyOne: [...document.querySelectorAll('[data-watch-pages]')].filter((el) => el.getClientRects().length > 0).length === 1,
      }
    })()`)
    check(
      '选集入口展开同一份目录，并让当前集落在视口里',
      sheet.title === '选集' && sheet.rows === 80 && sheet.inView && sheet.onlyOne,
    )
    const dialogFits = async () =>
      page.evaluate(`(() => {
        const panel = document.querySelector('[role="dialog"][aria-label="选集"]')
        const close = panel?.querySelector('button[aria-label="关闭"]')
        const box = panel?.getBoundingClientRect()
        const closeBox = close?.getBoundingClientRect()
        return {
          top: box ? Math.round(box.top) : null,
          bottom: box ? Math.round(box.bottom) : null,
          closeTop: closeBox ? Math.round(closeBox.top) : null,
          height: window.innerHeight,
        }
      })()`)
    await page.viewport(380, 560)
    await sleep(400)
    const fits380 = await dialogFits()
    check(
      '380×560 选集弹窗完整落在视口内，关闭键可见',
      fits380.top !== null && fits380.top >= 0 && fits380.bottom <= fits380.height && fits380.closeTop >= 0,
    )
    await page.viewport(900, 700)
    await sleep(400)
    const fits700 = await dialogFits()
    check(
      '900×700 选集弹窗完整落在视口内，关闭键可见',
      fits700.top !== null && fits700.top >= 0 && fits700.bottom <= fits700.height && fits700.closeTop >= 0,
    )
    await page.viewport(1000, 900)
    await sleep(400)
    await page.keyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await page.keyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await sleep(400)
    const afterEsc = await page.evaluate(`({
      dialog: !!document.querySelector('[role="dialog"][aria-label="选集"]'),
      focused: document.activeElement === ${pagePicker},
    })`)
    check('关掉选集面板后焦点回到触发按钮', !afterEsc.dialog && afterEsc.focused)

    await page.evaluate(`${pagePicker}?.click()`)
    await sleep(400)
    const switchedInSheet = await page.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="选集"]')
      const first = dialog?.querySelector('[data-watch-pages] ol li button')
      if (!first) return false
      first.click()
      return true
    })()`)
    await sleep(1500)
    const afterSheetSwitch = await page.evaluate(`(() => ({
      dialog: !!document.querySelector('[role="dialog"][aria-label="选集"]'),
      trigger: ${pagePicker}?.textContent?.trim() ?? '',
    }))()`)
    check(
      '从目录里选定分 P 才切集，面板随即收起',
      switchedInSheet && !afterSheetSwitch.dialog && afterSheetSwitch.trigger.includes('P1/80'),
    )
    await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
    await sleep(1200)
    const backToList = await page.evaluate(`({
      list: [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '').startsWith('观看')),
      watch: !!document.querySelector('video'),
    })`)
    check('连续换集后一次返回回到入口列表', backToList.list && !backToList.watch)


    // 历史：按日排列的播放日志。时刻来自 played_at，进度来自 position_ms。
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
      historyReady = await page.evaluate(`document.querySelectorAll('[data-history-row]').length > 0`)
    }
    const authorContrast = await page.evaluate(`(() => {
      const author = [...document.querySelectorAll('#scroll-main [data-history-row] span')]
        .find((element) => element.textContent?.trim() === '周杰伦')
      if (!author) return null
      let background = getComputedStyle(document.body).backgroundColor
      for (let node = author; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
          background = color
          break
        }
      }
      const box = author.getBoundingClientRect()
      return {
        color: getComputedStyle(author).color,
        background,
        center: [box.left + box.width / 2, box.top + box.height / 2],
      }
    })()`)
    check(
      '历史作者名达到 4.5:1',
      authorContrast && contrastRatio(authorContrast.color, authorContrast.background) >= 4.5,
    )
    if (authorContrast) {
      await page.mouseEvent({ type: 'mouseMoved', x: authorContrast.center[0], y: authorContrast.center[1] })
      await sleep(250)
      const hoveredAuthor = await page.evaluate(`(() => {
        const author = [...document.querySelectorAll('#scroll-main [data-history-row] span')]
          .find((element) => element.textContent?.trim() === '周杰伦')
        if (!author) return null
        let background = getComputedStyle(document.body).backgroundColor
        for (let node = author; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
            background = color
            break
          }
        }
        return { color: getComputedStyle(author).color, background }
      })()`)
      check(
        '历史作者名悬停时仍达到 4.5:1',
        hoveredAuthor && contrastRatio(hoveredAuthor.color, hoveredAuthor.background) >= 4.5,
      )
    }
    const firstPage = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('#scroll-main [data-history-row]')]
      const first = rows[0]
      const clocks = [...(first?.querySelectorAll('time') ?? [])]
      const visibleClock = clocks.find((node) => node.offsetParent !== null)
      return {
        rows: rows.length,
        loadMore: !![...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '加载更早记录'),
        clock: (visibleClock?.textContent || '').trim(),
        playedAt: Number(first?.dataset.playedAt),
        position: Number(first?.dataset.positionMs),
        finished: (first?.innerText || '').includes('已播完'),
        finishedAction: (first?.querySelector('button[data-history-play]')?.getAttribute('aria-label') || '').startsWith('从头播放'),
      }
    })()`)
    check(
      '历史首屏 60 条并给出加载更早',
      openedHistory && historyReady && firstPage.rows === 60 && firstPage.loadMore,
    )
    check(
      '首行显示 played_at 的本地时刻，进度按 position_ms 显示已播完',
      /^([01]\d|2[0-3]):[0-5]\d$/.test(firstPage.clock) &&
        Number.isFinite(firstPage.playedAt) &&
        firstPage.position > 0 &&
        firstPage.finished,
    )
    check('已播完的记录主操作改叫从头播放', firstPage.finishedAction)
    const historySpacing = await page.evaluate(`(() => {
      const sections = [...document.querySelectorAll('#scroll-main section')]
      const first = sections[0]
      const second = sections[1]
      if (!first || !second) return null
      const rows = [...first.querySelectorAll('[data-history-row]')]
      const lastRow = rows.at(-1)
      const heading = second.querySelector('h2')
      return {
        gap:
          lastRow && heading
            ? heading.getBoundingClientRect().top - lastRow.getBoundingClientRect().bottom
            : null,
        heights: rows.slice(0, 4).map((row) => Math.round(row.getBoundingClientRect().height)),
        headingInside: second.contains(heading),
      }
    })()`)
    check(
      '历史日期组只留一层间距，行高保持紧凑',
      historySpacing &&
        historySpacing.gap >= 18 &&
        historySpacing.gap <= 34 &&
        historySpacing.headingInside &&
        historySpacing.heights.every((height) => height >= 60 && height <= 100),
    )
    const startedFromHistory = await page.evaluate(`(() => {
      const button = document.querySelector('[data-history-row] button[data-history-play]')
      button?.click()
      return !!button
    })()`)
    await sleep(1400)
    const liveHistory = await page.evaluate(`(() => {
      const row = document.querySelector('[data-history-row][aria-current="true"]')
      return {
        active: !!row,
        label: (row?.querySelector('[data-history-progress]')?.textContent || '').trim(),
      }
    })()`)
    check(
      '历史当前行显示实时进度，不再停在已播完',
      startedFromHistory && liveHistory.active && liveHistory.label.startsWith('播至'),
    )
    await page.clickExactText('加载更早记录')
    let loadedAll = false
    for (let i = 0; i < 20 && !loadedAll; i += 1) {
      await sleep(300)
      loadedAll = await page.evaluate(`document.querySelectorAll('[data-history-row]').length === 100`)
    }
    const afterLoad = await page.evaluate(`(() => {
      const text = document.body.innerText
      const heads = [...document.querySelectorAll('h2')].map((h) => (h.textContent || '').trim())
      const rows = [...document.querySelectorAll('[data-history-row]')]
      const long = rows.find((row) => (row.textContent || '').includes('跨年同日 · 2025'))
      const unknown = rows.find((row) => (row.textContent || '').includes('跨年同日 · 2024'))
      return {
        has61: text.includes('历史记录 61'),
        groups: heads.filter((h) => h.includes('4 月 10 日')),
        more: !![...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '加载更早记录'),
        longProgress: (long?.innerText || '').includes('播至 18:42'),
        longBar: long ? !!long.querySelector('div[style*="width"]') : false,
        unknownProgress: (unknown?.innerText || '').includes('播至 1:30'),
        unknownBar: unknown ? !!unknown.querySelector('div[style*="width"]') : false,
      }
    })()`)
    check('加载更早记录能找回第 61 条', loadedAll && afterLoad.has61)
    check(
      '同月同日不同年份分成两组',
      afterLoad.groups.length === 2 &&
        afterLoad.groups.some((g) => g.startsWith('2025')) &&
        afterLoad.groups.some((g) => g.startsWith('2024')),
    )
    check(
      '已知进度显示播至时刻与进度条，未知时长只给已知时间',
      afterLoad.longProgress && afterLoad.longBar && afterLoad.unknownProgress && !afterLoad.unknownBar,
    )
    check('取完 100 条后按钮收起', !afterLoad.more)

    // 续播：点第二行（12 秒续播点），播放条应接在那个位置而不是从头。
    const resumed = await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-history-row]')]
        .find((item) => (item.textContent || '').includes('历史记录 2 ·'))
      const hit = row?.querySelector('button[data-history-play]')
      if (!hit) return null
      hit.click()
      return row.dataset.positionMs
    })()`)
    await sleep(900)
    const resumeState = await page.evaluate(`(() => {
      const slider = document.querySelector('[aria-label="播放进度"]')
      const bar = document.querySelector('[data-player-bar]')
      return {
        ratio: slider ? Number(slider.getAttribute('aria-valuenow')) : null,
        text: (bar?.innerText || document.body.innerText).slice(0, 400),
      }
    })()`)
    check(
      '从历史续播落在记录的 position_ms',
      Number(resumed) === 12000 && resumeState.ratio !== null && resumeState.ratio >= 40 && resumeState.ratio <= 60,
    )
    // 后面的搜索与队列用例不假设有声音在放，验完就停掉。
    await page.evaluate(`document.querySelector('button[aria-label="暂停"]')?.click()`)
    await sleep(300)

    // 删除单条：只删掉 2024 那一组唯一一行，日期标题不能残留成空组。
    // 菜单：打开后焦点落在唯一一项上，Esc 关闭并把焦点还给触发按钮。
    await page.evaluate(`(() => {
      const row = document.querySelectorAll('[data-history-row]')[0]
      row?.querySelector('button[aria-haspopup="dialog"]')?.click()
    })()`)
    await sleep(300)
    const menuFocus = await page.evaluate(`({
      dialog: !!document.querySelector('[role="dialog"][aria-label="历史记录操作"]'),
      focused: document.activeElement?.textContent?.trim() ?? '',
    })`)
    await page.keyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await page.keyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await sleep(300)
    const menuClosed = await page.evaluate(`({
      dialog: !!document.querySelector('[role="dialog"][aria-label="历史记录操作"]'),
      focused: document.activeElement?.getAttribute('aria-label') ?? '',
    })`)
    check('更多菜单打开时聚焦唯一动作', menuFocus.dialog && menuFocus.focused.includes('删除这条记录'))
    check(
      'Esc 关闭更多菜单并把焦点还给触发按钮',
      !menuClosed.dialog && menuClosed.focused.startsWith('更多操作'),
    )

    const deleted = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-history-row]')]
      const row = rows.find((item) => (item.textContent || '').includes('跨年同日 · 2024'))
      const more = row?.querySelector('button[aria-haspopup="dialog"]')
      if (!more) return false
      more.click()
      return true
    })()`)
    await sleep(300)
    const menuOpen = await page.evaluate(
      `!!document.querySelector('[role="dialog"][aria-label="历史记录操作"]')`,
    )
    const clickedDelete = await page.evaluate(`(() => {
      const item = [
        ...document.querySelectorAll('[role="dialog"][aria-label="历史记录操作"] button'),
      ]
        .find((node) => (node.textContent || '').includes('删除这条记录'))
      if (!item) return false
      item.click()
      return true
    })()`)
    let afterDelete = null
    for (let i = 0; i < 20 && !afterDelete; i += 1) {
      await sleep(200)
      afterDelete = await page.evaluate(`(() => {
        const rows = [...document.querySelectorAll('[data-history-row]')]
        if (rows.length !== 99) return null
        const sections = [...document.querySelectorAll('#scroll-main section')]
        return {
          rows: rows.length,
          emptyGroups: sections.filter((section) => section.querySelectorAll('[data-history-row]').length === 0).length,
          left2024: (document.body.innerText || '').includes('2024 年 4 月 10 日'),
          left2024Row: rows.some((row) => (row.textContent || '').includes('跨年同日 · 2024')),
        }
      })()`)
    }
    check(
      '删除日期组最后一条后不残留空日期组',
      deleted && menuOpen && clickedDelete && afterDelete &&
        afterDelete.rows === 99 && afterDelete.emptyGroups === 0 && !afterDelete.left2024 && !afterDelete.left2024Row,
    )
    const focusAfterDelete = await page.evaluate(
      `document.activeElement?.closest?.('[data-history-row]')?.dataset.key ?? null`,
    )
    check(
      '删掉焦点所在行后焦点落到相邻行',
      focusAfterDelete === 'BV1Mk4y11000-cross-2025',
    )

    // 返回恢复：滚动到列表中段、把焦点停在某一行，去发现页再回来。
    const parked = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-history-row]')]
      const row = rows[20]
      const box = document.getElementById('scroll-main')
      if (!row || !box) return null
      box.scrollTop = 600
      row.querySelector('button[data-history-play]')?.focus()
      return { key: row.dataset.key, scrollTop: Math.round(box.scrollTop) }
    })()`)
    await sleep(200)
    const leftHistory = await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '发现') : null
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(1200)
    const backToHistory = await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '历史') : null
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(800)
    const restored = await page.evaluate(`(() => {
      const box = document.getElementById('scroll-main')
      const active = document.activeElement
      const row = active?.closest?.('[data-history-row]')
      const boxRect = box?.getBoundingClientRect()
      const rowRect = row?.getBoundingClientRect()
      return {
        rows: document.querySelectorAll('[data-history-row]').length,
        scrollTop: box ? Math.round(box.scrollTop) : null,
        focusKey: row?.dataset.key ?? null,
        inView: !!(boxRect && rowRect && rowRect.top >= boxRect.top - 1 && rowRect.top <= boxRect.top + 64),
      }
    })()`)
    check(
      '从历史离开再回来，页数、那一行和焦点都原样恢复',
      leftHistory && backToHistory && parked &&
        restored.rows === 99 &&
        restored.inView &&
        restored.focusKey === parked.key,
    )

    // 窄窗：时间收在标题上方，进度落在作者下方，页面不横向溢出。
    await page.viewport(380, 820)
    await sleep(600)
    const narrow = await page.evaluate(`(() => {
      const row = document.querySelector('[data-history-row]')
      if (!row) return null
      const clocks = [...row.querySelectorAll('time')].filter((node) => node.offsetParent !== null)
      const clock = clocks[0]
      const title = row.querySelector('button[data-history-play][title]')
      const artist = [...row.querySelectorAll('span')].find((node) => (node.textContent || '').trim() === '周杰伦')
      const progress = [...row.querySelectorAll('div')].find((node) => (node.textContent || '').trim().startsWith('播至') || (node.textContent || '').trim() === '已播完')
      const rect = (node) => (node ? node.getBoundingClientRect() : null)
      const clockBox = rect(clock)
      const titleBox = rect(title)
      const artistBox = rect(artist)
      const progressBox = rect(progress)
      return {
        clock: clockBox ? { top: clockBox.top, left: clockBox.left } : null,
        title: titleBox ? { top: titleBox.top, right: titleBox.right } : null,
        artistBottom: artistBox?.bottom ?? null,
        progressTop: progressBox?.top ?? null,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }
    })()`)
    check(
      '窄窗把时刻收在标题上方、进度放在作者下方',
      narrow && narrow.clock && narrow.title &&
        narrow.clock.top < narrow.title.top &&
        narrow.progressTop !== null && narrow.artistBottom !== null &&
        narrow.progressTop >= narrow.artistBottom - 2,
    )
    check('窄窗历史行不横向溢出', narrow && narrow.overflow <= 0)

    await page.viewport(1320, 900)
    await sleep(300)

    // 清空之后离开再回来：不能把会话里那份旧列表又端上来。
    await page.clickExactText('清空历史')
    await sleep(200)
    await page.clickExactText('清空')
    let historyCleared = false
    for (let i = 0; i < 20 && !historyCleared; i += 1) {
      await sleep(200)
      historyCleared = await page.evaluate(
        `document.querySelectorAll('[data-history-row]').length === 0 && document.body.innerText.includes('还没有播放记录')`,
      )
    }
    await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '发现') : null
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(900)
    await page.evaluate(`(() => {
      const nav = document.querySelector('nav[aria-label="主导航"]')
      const hit = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '历史') : null
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await sleep(900)
    const afterClearReturn = await page.evaluate(`({
      rows: document.querySelectorAll('[data-history-row]').length,
      empty: document.body.innerText.includes('还没有播放记录'),
      focused: document.activeElement?.hasAttribute('data-history-empty') ?? false,
      tag: document.activeElement?.tagName ?? '',
      label: document.activeElement?.getAttribute('aria-label') ?? '',
    })`)
    check(
      `清空历史后离开再回来不会复用旧列表，焦点落在空态 ${JSON.stringify(afterClearReturn)}`,
      historyCleared && afterClearReturn.rows === 0 && afterClearReturn.empty && afterClearReturn.focused,
    )

  // 返回后用户立刻滚动：自动校正不能把位置抢回去。
  await page.viewport(1320, 900)
  await sleep(200)
  await page.evaluate(`location.href = ${JSON.stringify(WEB)}`)
  await sleep(4500)
  const deep = await page.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-track-card]')]
    const card = cards.at(-1)
    card?.querySelector('button[aria-label^="观看"]')?.click()
    return !!card
  })()`)
  let deepVideo = false
  for (let i = 0; i < 20 && !deepVideo; i += 1) {
    await sleep(300)
    deepVideo = await page.evaluate(`!!document.querySelector('video')`)
  }
  await page.evaluate(`document.querySelector('button[aria-label="返回"]')?.click()`)
  // FocusRestore 先等目标稳定再聚焦，聚焦后的校正才由滚轮取消；
  // 先等焦点真正落回卡片，再模拟用户滚动，别跟这段时序抢跑。
  let focusRestored = false
  for (let i = 0; i < 50 && !focusRestored; i += 1) {
    await sleep(100)
    focusRestored = await page.evaluate(
      `document.activeElement?.getAttribute('data-focus-id')?.startsWith('card:') === true`,
    )
  }
  await page.mouseEvent({ type: 'mouseWheel', x: 660, y: 450, deltaX: 0, deltaY: -200 })
  await sleep(100)
  await page.evaluate(`document.getElementById('scroll-main').scrollTop = 0`)
  await sleep(1000)
  const afterUserScroll = await page.evaluate(
    `Math.round(document.getElementById('scroll-main')?.scrollTop ?? 0)`,
  )
  check(
    `返回后用户滚动不会被自动校正拉回 ${JSON.stringify({ deep, deepVideo, focusRestored, afterUserScroll })}`,
    deep && deepVideo && focusRestored && afterUserScroll === 0,
  )

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
    let usersEnded = false
    for (let i = 0; i < 8 && !usersEnded; i += 1) {
      await clickMoreUsers()
      await sleep(400)
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
    await page.evaluate(
      `document.querySelector('[role="dialog"][aria-label="播放详情"] button[aria-label="关闭详情"]')?.click()`,
    )
    await sleep(300)
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
    await page.keyEvent({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await page.keyEvent({
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    let narrowQueueOpened = null
    for (let i = 0; i < 20; i += 1) {
      await sleep(100)
      narrowQueueOpened = await page.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="播放详情"]')
        return {
          open: !!dialog,
          focusInside: !!dialog && dialog.contains(document.activeElement),
          initialFocus: document.activeElement?.getAttribute('aria-label') ?? '',
        }
      })()`)
      if (narrowQueueOpened.open && narrowQueueOpened.focusInside) break
    }
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
