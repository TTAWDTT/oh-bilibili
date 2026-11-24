import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const pages = [
  { kind: 'following', label: '关注', author: '[data-following-author="5000"] .text-work-name',
    authorLink: '[data-following-space]', work: '[data-following-work]', cover: '[data-following-work] img' },
  { kind: 'dynamic', label: '动态', author: 'button[data-dynamic-open="author"]',
    authorLink: '[data-dynamic-open="author"]', work: '[data-dynamic-open="video"]', cover: '[data-dynamic-open="video"] + span img' },
  { kind: 'weekly', label: '每周必看', author: '[data-focus-id^="wide-author:"] span:last-child',
    authorLink: '[data-focus-id^="wide-author:"]', work: '[data-wide-card] [data-focus-id^="wide:"]', cover: '[data-wide-card] img' },
]

export async function checkTypography(page, web, wait, check) {
  const out = process.env.TYPOGRAPHY_OUTPUT
  if (out) await mkdir(out, { recursive: true })
  await page.cdp('DOM.enable')
  await page.cdp('CSS.enable')
  console.log('浏览器', await page.evaluate('navigator.userAgent'), '调整视口前的 DPR', page.nativeScale)
  if (process.env.TYPOGRAPHY_EXPECT_DPR) {
    check('浏览器启动时的系统缩放', page.nativeScale === Number(process.env.TYPOGRAPHY_EXPECT_DPR))
  }
  for (const width of [1440, 1100]) {
    await page.viewport(width, 900)
    const normal = new Map()
    for (const mode of ['with-cover', 'missing']) {
      await page.evaluate(`location.href = ${JSON.stringify(`${web}?typographySample=${mode}&loggedIn`)}`)
      await wait("!document.querySelector('#boot-splash') && document.querySelector('nav[aria-label=\"主导航\"]') && document.fonts.status === 'loaded'")
      for (const entry of pages) {
        const { kind, label, work, cover } = entry
        const prefix = `${width} ${label} ${mode}`
        await page.clickExactText(label)
        await prepareSample(page, wait, kind)
        const sample = await inspectSample(page, entry)
        console.log(prefix, JSON.stringify(sample))
        check(`${prefix} 共同字号、边距及长作者名`, sample.title === '26px/34px' && sample.inset === 32 &&
          sample.author === '15px/22px' && sample.body === '15px/24px' && sample.meta === '12.5px/18px' &&
          sample.name.includes('云上的实验室') && sample.fonts.some(font => /LXGW.?WenKai/i.test(font)))
        check(`${prefix} 投稿、作者和推荐语齐全，列表无横向溢出`, sample.hasTitle && sample.hasNote && !sample.overflow)
        check(`${prefix} 封面符合样本`, await page.evaluate(`document.querySelector('${cover}').hasAttribute('data-cover-fallback') === ${mode === 'missing'}`))
        if (mode === 'with-cover') normal.set(kind, sample.cover)
        else check(`${prefix} 缺图保留原封面位置、大小`, sample.cover.join() === normal.get(kind).join())
        if (mode === 'with-cover') {
          await page.evaluate(`document.querySelector('${entry.authorLink}').click()`)
          const correctAuthor = await wait("document.querySelector('[data-up-mid]')?.dataset.upMid === '5000'")
          await page.clickExactText('返回')
          const focusReturned = await wait(`document.activeElement.matches('${entry.authorLink}')`)
          check(`${prefix} 作者入口与视频独立，返回仍在署名或进入空间按钮`, correctAuthor && focusReturned)
        }
        await page.keyEvent({ type: 'keyDown', key: 'Tab', code:'Tab', windowsVirtualKeyCode:9 })
        await page.keyEvent({ type: 'keyUp', key: 'Tab', code:'Tab', windowsVirtualKeyCode:9 })
        await page.evaluate(`document.querySelector('${work}').focus({preventScroll:true})`)
        check(`${prefix} 作品的键盘焦点可见`, await page.evaluate("document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2"))
        if (out) await saveViews(page, out, `${kind}-${width}-${mode}`)
        if (kind === 'weekly') {
          // 打开目录下部的作品，才能发现返回时丢失阅读位置。
          await page.evaluate("document.querySelectorAll('[data-wide-card] [data-focus-id^=\"wide:\"]')[8].focus()")
          await page.evaluate("document.activeElement.scrollIntoView({block:'center'})")
        }
        const before = await page.evaluate("({top:document.querySelector('#scroll-main').scrollTop, id:document.activeElement.dataset.focusId || '', label:document.activeElement.getAttribute('aria-label')})")
        await page.keyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text:'\r', unmodifiedText:'\r' })
        await page.keyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
        await wait("document.querySelector('#watch-comments')")
        await page.evaluate("document.querySelector('button[aria-label=\"返回\"]').click()")
        await wait(`document.activeElement.matches('${work}')`)
        const after = await page.evaluate("({top:document.querySelector('#scroll-main').scrollTop, id:document.activeElement.dataset.focusId || '', label:document.activeElement.getAttribute('aria-label')})")
        check(`${prefix} 打开投稿后返回同一作品及原阅读位置 ${before.top} → ${after.top}`,
          before.id === after.id && before.label === after.label && Math.abs(after.top - before.top) <= 2)
      }
    }
  }
  await page.cdp('Network.enable')
  await page.cdp('Network.setBlockedURLs', { urls: ['*LXGWWenKai-Regular.woff2*'] })
  await page.cdp('Network.setCacheDisabled', { cacheDisabled:true })
  await page.evaluate(`location.href = ${JSON.stringify(`${web}?typographySample=missing&loggedIn&fontFallback`)}`)
  await wait("location.search.includes('fontFallback') && !document.querySelector('#boot-splash') && document.querySelector('nav[aria-label=\"主导航\"]')")
  await page.clickExactText('每周必看')
  await prepareSample(page, wait, 'weekly')
  const local = await inspectSample(page, pages[2])
  console.log('禁用随包字体后系统实际使用', local.fonts)
  // 部分机器还安装了文楷。只移除这一项，保留产品声明的其余字体及次序。
  await page.evaluate(`(() => {
    const heading = document.querySelector('#scroll-main .text-page-title')
    const stack = getComputedStyle(heading).fontFamily.split(',')
    document.body.style.fontFamily = stack.slice(1).join(',')
    return heading.offsetWidth
  })()`)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const fallback = await inspectSample(page, pages[2])
  console.log('模拟本机也未安装文楷时的实际页标题字体', fallback.fonts)
  check('缺少文楷时标题使用系统中文字体且不溢出',
    fallback.fonts.length > 0 && fallback.fonts.every(font => !/LXGW.?WenKai/i.test(font)) && !fallback.overflow)
}

async function prepareSample(page, wait, kind) {
  const root = "document.querySelector('#scroll-main')"
  if (kind === 'following') {
    await wait("document.querySelector('[data-following-search]') && document.querySelector('[data-following-author=\"5000\"]')")
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-following-search]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '云上的实验室')
      input.dispatchEvent(new Event('input', {bubbles:true}))
    })()`)
    await page.evaluate("document.querySelector('[data-following-author=\"5000\"]').click()")
  } else if (kind === 'dynamic') {
    const button = "[...document.querySelectorAll('button[title^=\"只看 云上的实验室\"]')].find(b => b.getClientRects().length)"
    await wait(button)
    await page.evaluate(`${button}.click()`)
    await wait("document.querySelector('button[title^=\"取消只看 云上的实验室\"][aria-pressed=true]')")
  } else {
    await wait("document.querySelector('button[aria-label=\"上一期\"]:not(:disabled)') && document.querySelector('[data-weekly-issue]')")
    const issue = await page.evaluate("document.querySelector('[data-weekly-issue]').dataset.weeklyIssue")
    await page.evaluate("document.querySelector('button[aria-label=\"上一期\"]').click()")
    await wait(`document.querySelector('[data-weekly-issue="${Number(issue) - 1}"]')`)
  }
  await wait(`${root}?.innerText.includes('An Ambient Session') && ${root}.innerText.includes('从一段阴天')`)
  await page.evaluate('document.fonts.ready')
}

async function inspectSample(page, {author, cover}) {
  const { root } = (await page.cdp('DOM.getDocument')).result
  const { nodeId } = (await page.cdp('DOM.querySelector', {nodeId:root.nodeId, selector:'#scroll-main .text-page-title'})).result
  const { fonts } = (await page.cdp('CSS.getPlatformFontsForNode', {nodeId})).result
  const metrics = await page.evaluate(`(() => {
    const root = document.querySelector('#scroll-main')
    const title = root.querySelector('.text-page-title')
    const author = root.querySelector('${author}')
    const rect = root.querySelector('${cover}').getBoundingClientRect()
    const typography = (el) => getComputedStyle(el).fontSize + '/' + getComputedStyle(el).lineHeight
    return {
      width:root.clientWidth, dpr:devicePixelRatio, inset:title.getBoundingClientRect().left - root.getBoundingClientRect().left,
      title:typography(title), author:typography(author), name:author.innerText,
      body:typography(root.querySelector('.text-reading-body')), meta:typography(root.querySelector('.text-page-meta')),
      cover:[rect.x, rect.y, rect.width, rect.height].map(Math.round),
      overflow:root.scrollWidth > root.clientWidth,
      hasTitle:root.innerText.includes('An Ambient Session'), hasNote:root.innerText.includes('从一段阴天'),
    }
  })()`)
  return {...metrics, fonts:fonts.filter(font => font.glyphCount > 0).map(font => font.postScriptName)}
}

async function saveViews(page, output, name) {
  for (const [mode,type] of [['color','none'], ['gray','achromatopsia']]) {
    await page.cdp('Emulation.setEmulatedVisionDeficiency', { type })
    const { data } = (await page.cdp('Page.captureScreenshot', { format:'png' })).result
    await writeFile(join(output, `${name}-${mode}.png`), Buffer.from(data,'base64'))
  }
  await page.cdp('Emulation.setEmulatedVisionDeficiency', { type:'none' })
}
