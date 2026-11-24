import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function checkSocialPages(page, web, wait, check) {
  const buttons = (scope, label) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})]
    .find(b => b.getClientRects().length && (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(label)})`
  const element = selector => `document.querySelector(${JSON.stringify(selector)})`
  const click = async expr => {
    await wait(expr)
    await page.evaluate(`(${expr}).click()`)
  }
  const byName = (scope, text) => click(buttons(scope, text))
  const newPage = async query => {
    await page.evaluate(`location.href = ${JSON.stringify(web + '?' + query)}`)
    await wait(`location.search === ${JSON.stringify('?' + query)} && document.querySelector('[data-home-recommend]')`)
  }
  const openSpace = () => click(element('[data-track-card] button[aria-label^="UP "]'))
  const field = element('textarea[aria-label$="发私信"]')
  const log = element('[role="log"]')
  const note = '这是一条预览环境里的私信。'
  const fill = async (value) => {
    await wait(field)
    await page.evaluate(`(() => {
      const input = ${field}
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
  }

  await page.viewport(1320, 900)
  await newPage('loggedIn=1&directRecall=1')
  await byName('nav[aria-label="主导航"]', '消息')
  await byName('nav[aria-label="消息分类"]', '私信')
  await click(element('[data-direct-peer="5000"]'))
  await wait(`${log}?.querySelector('.dm-image')`)
  const badge = element('nav[aria-label="消息分类"] button[aria-label="私信"]')
  await wait(`${badge}.textContent.includes('2')`)
  await byName('body', '刷新私信')
  await wait(`!${badge}.textContent.includes('2')`)
  check('已读写入失败后刷新同一页可以重试', true)
  await byName('body', '刷新私信')
  await wait(`!${log}.querySelector('.dm-image')`)
  await byName('body', '更早的消息')
  await wait(`${log}.textContent.includes('消息已撤回')`)
  check('跨页撤回会清除图片且后续补页不会恢复原文', await page.evaluate(`!${log}.textContent.includes('看到你发的片段啦') && !${log}.querySelector('.dm-image')`))
  await newPage('loggedIn=1&failDirectSendOnce=1')
  await byName('nav[aria-label="主导航"]', '消息')
  await byName('nav[aria-label="消息分类"]', '私信')
  const first = element('[data-direct-peer="5000"]')
  const other = element('[data-direct-peer="5002"]')
  const tab = element('nav[aria-label="消息分类"] button[aria-label="私信"]')
  await wait(first)
  check('首次进入私信只列联系人，不打开对话', !(await page.evaluate(field)))
  await wait(`${tab}.textContent.includes('2') && document.querySelector('button[aria-label="消息，12 条未读"]')`)
  await byName('body', '更多联系人')
  await wait(element('[data-direct-peer="5003"]'))
  check('翻到下一页联系人后仍保留原列表和未读数', await page.evaluate(`!!${first} && ${tab}.textContent.includes('2')`))
  await click(first)
  const messages = 'document.querySelectorAll("[role=log] [data-direct-message]")'
  await wait(`${messages}.length > 0`)
  await wait(`!${tab}.textContent.includes('2') && document.querySelector('button[aria-label="消息，10 条未读"]')`)
  check('选中会话后，分类和顶栏同步扣除其未读数', true)
  const recent = await page.evaluate(`Array.from(${messages}, m => m.dataset.directMessage)`)
  await byName('body', '更早的消息')
  await wait(`${messages}.length > ${recent.length}`)
  const older = await page.evaluate(`Array.from(${messages}, m => m.dataset.directMessage)`)
  check('向前翻阅保留最近的私信，消息不重复', recent.every(id => older.includes(id)) && new Set(older).size === older.length)

  await fill('   ')
  check('空白私信不能发送', await page.evaluate(`(${buttons('body', '发送')}).disabled`))
  await fill(note)
  await byName('body', '发送')
  await wait(element('[role="alert"]'))
  check('发送失败保留输入，消息记录中不会先出现一条成功记录',
    await page.evaluate(`${field}.value === ${JSON.stringify(note)} && !${log}.innerText.includes(${JSON.stringify(note)})`))
  await byName('body', '发送')
  await wait(`${field}.value === '' && ${log}.innerText.includes(${JSON.stringify(note)})`)
  check('重试成功后只有一条本人的私信', await page.evaluate(`Array.from(${messages}).filter(m =>
    m.dataset.senderMid === '1960976249' && m.textContent.includes(${JSON.stringify(note)})).length === 1`))
  if (process.env.SOCIAL_OUTPUT) {
    const screenshot = await page.cdp('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(process.env.SOCIAL_OUTPUT, '私信预览（演示数据）.png'), Buffer.from(screenshot.result.data, 'base64'))
  }

  await fill('留给第一位联系人的草稿')
  await click(other)
  await wait(`${log}?.getAttribute('aria-label')?.includes('不睡觉的鹿') && ${messages}.length`)
  check('切换联系人后不显示上一人的发言', await page.evaluate(`!${log}.textContent.includes(${JSON.stringify(note)})`))
  await fill('第二位联系人的草稿')
  await click(first)
  await wait(`${field}?.value === '留给第一位联系人的草稿'`)
  await click(other)
  await wait(`${field}?.value === '第二位联系人的草稿'`)
  check('切换联系人后各自的草稿保留在原对话', true)
  await page.viewport(390, 844)
  await byName('body', '返回联系人')
  await wait(`${first}?.getClientRects().length`)
  check('窄窗能够返回联系人列表', await page.evaluate(`document.documentElement.scrollWidth <= innerWidth && !${field}?.getClientRects().length`))

  await page.viewport(1320, 900)
  await click(other)
  await wait(`${messages}.length > 0 && Array.from(${log}.querySelectorAll('img')).every(img => img.complete)`)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await byName('body', '账号菜单')
  await byName('body', '退出登录')
  await wait(`!${field} && !${first} && !${log}`)
  check('退出账号后联系人、聊天记录和输入框一起收起', true)
  await newPage('loggedIn=1&spaceShowcase=1')
  await openSpace()
  await wait(element('[data-space-banner]'))
  const hero = element('[data-author-hero]')
  await wait(`${hero}?.textContent.includes('置顶投稿')`)
  check('作者设置的头图与置顶投稿出现在个人空间', true)
  await byName('#scroll-main', '代表作')
  await wait(element('[data-track-card]'))
  check('代表作可从空间内容栏单独查看', await page.evaluate(`(${buttons('#scroll-main', '代表作')}).getAttribute('aria-pressed') === 'true'`))
  await byName('#scroll-main', '合集和系列')
  await click(element('[data-space-collection]'))
  const work = element('[data-collection-work]')
  await wait(work)
  const title = await page.evaluate(`${work}.getAttribute('aria-label')`)
  await click(work)
  await wait(`document.querySelector('button[aria-label="返回"]') && !${work}`)
  await click(element('button[aria-label="返回"]'))
  await wait(`${work}?.getAttribute('aria-label') === ${JSON.stringify(title)}`)
  check('点开合集作品后返回同一目录', true)

  const dynamics = 'section[aria-label="作者动态"]'
  await byName('nav[aria-label="空间内容"]', '动态')
  await wait(element(dynamics + ' [data-dynamic-id] img[alt="[doge]"]'))
  check('作者空间的置顶动态、正文表情和投票卡一起出现', await page.evaluate(`(() => {
    const entry = document.querySelector(${JSON.stringify(dynamics + ' [data-dynamic-id]')})
    return entry.textContent.includes('置顶') && entry.querySelector('a[href*="vote_id"]')?.textContent.includes('下一期想看什么')
  })()`))
  const filter = element(dynamics + ' input[type="search"]')
  await page.evaluate(`(() => {
    const input = ${filter}
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '晴天')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await wait(`!${element(dynamics + ' [data-dynamic-id]')}`)
  await byName(dynamics, '更多动态')
  await wait(`${element(dynamics + ' [data-dynamic-id]')}?.textContent.includes('晴天')`)
  check('空间动态搜索也能找到随后翻页加载的内容', true)
  await newPage('spaceDynamicsBlocked=1')
  await openSpace()
  await byName('nav[aria-label="空间内容"]', '动态')
  await wait(buttons(dynamics, '重试'))
  check('受限时保留当前作者官网动态入口', await page.evaluate(`(() => {
    const author = document.querySelector('[data-up-mid]').dataset.upMid
    return document.querySelector(${JSON.stringify(dynamics + ' a')})?.href === 'https://space.bilibili.com/' + author + '/dynamic'
  })()`))

  await newPage('loggedIn=1&spaceEmpty=1')
  await openSpace()
  await wait(buttons('#scroll-main', '发消息'))
  const author = await page.evaluate("document.querySelector('#scroll-main h2')?.textContent.trim()")
  check('没有投稿的账号仍显示资料和发消息入口', !!author && !await page.evaluate(hero))
  await byName('#scroll-main', '发消息')
  await wait(`${field}?.getAttribute('aria-label')?.includes(${JSON.stringify(author)})`)
  check('从个人空间发消息直接进入该用户的站内对话', true)
}
