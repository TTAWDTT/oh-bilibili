export async function checkSpaceCatalog(page, web, wait, check) {
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
  await page.viewport(1320, 900)
  await newPage('loggedIn=1&spaceShowcase=1')
  await openSpace()
  await byName('#scroll-main', '更多内容')
  const entry = element('[data-catalog-item]')
  const picker = element('select[aria-label="选择空间栏目"]')
  const pick = async value => {
    await page.evaluate(`(() => { const node = ${picker}; node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  }
  await wait(`${entry}?.textContent.includes('开拍啦')`)
  await byName('nav[aria-label="公开内容翻页"]', '下一页')
  await wait(`${entry}?.textContent.includes('拍摄续记')`)
  await byName('nav[aria-label="公开内容翻页"]', '上一页')
  await wait(`${entry}?.textContent.includes('开拍啦')`)
  check('图文目录可往返翻页', true)
  await pick('reading_lists')
  await wait(`${entry}?.textContent.includes('拍摄笔记')`)
  await click(entry)
  await wait(`${entry}?.textContent.includes('开拍啦')`)
  await byName('#scroll-main', '返回文集')
  await wait(`${entry}?.textContent.includes('拍摄笔记')`)
  await pick('created')
  await wait(`${entry}?.textContent.includes('影像收藏')`)
  await click(entry)
  await wait(element('section[aria-label="影像收藏"] [data-catalog-item]'))
  const favTitle = await page.evaluate(`${entry}.innerText`)
  await click(entry)
  await click(element('button[aria-label="返回"]'))
  await wait(`${entry}?.innerText === ${JSON.stringify(favTitle)}`)
  check('文集目录和收藏夹里的视频均可打开，返回后保留原目录', true)
  await pick('anime')
  await wait("document.querySelector('#scroll-main')?.innerText.includes('UP 主没有公开追番')")
  await pick('collected')
  await wait("document.querySelector('#scroll-main')?.innerText.includes('这里还没有公开内容')")
  check('关闭公开与公开后空列表有不同提示', true)

  await byName('#scroll-main', '投稿')
  const input = element('input[aria-label="搜索 TA 的投稿"]')
  await wait(element('[data-track-card]'))
  const searchVideos = async value => {
    await page.evaluate(`(() => {
      const node = ${input}
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${JSON.stringify(value)})
      node.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await byName('form[aria-label="搜索这个 UP 主的投稿"]', '搜索')
  }
  await searchVideos('不存在的投稿关键词_xyz')
  await wait("document.querySelector('section[aria-label=投稿搜索结果]')?.textContent.includes('没有找到相关投稿')")
  await searchVideos(favTitle.trim().split('\n')[0])
  await wait(element('section[aria-label="投稿搜索结果"] [data-track-card]'))
  await click(element('section[aria-label="投稿搜索结果"] [data-track-card] button'))
  await click(element('button[aria-label="返回"]'))
  await wait(`${input}?.value === ${JSON.stringify(favTitle.trim().split('\n')[0])} && document.querySelector('section[aria-label="投稿搜索结果"] [data-track-card]')`)
  check('搜索当前作者、空结果和观看后返回搜索结果', true)
}
