// 设计系统审计。在页面里跑，返回违规计数与明细。
// 用法：把整个文件内容作为表达式丢给浏览器求值（IIFE 返回对象）。
;(() => {
  const violations = []
  const add = (rule, detail) => violations.push({ rule, detail })

  const all = [...document.querySelectorAll('body *')]
  const visible = all.filter((n) => {
    const r = n.getBoundingClientRect()
    const s = getComputedStyle(n)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  })

  // 1. 字号种类
  const sizes = new Set()
  for (const n of visible) {
    if (!n.textContent?.trim()) continue
    sizes.add(getComputedStyle(n).fontSize)
  }
  const allowed = new Set(['10px','11px','12px','13px','14px','16px','19px'])
  for (const s of sizes) if (!allowed.has(s)) add('字号不在音阶上', s)
  if (sizes.size > 7) add('字号种类', `${sizes.size} 种：${[...sizes].sort().join(' ')}`)

  // 2. 间距是否 4 的倍数（只查 padding/margin 的 px 值）
  let offGrid = 0
  const offSamples = new Set()
  for (const n of visible) {
    const s = getComputedStyle(n)
    for (const p of ['paddingTop', 'paddingLeft', 'paddingBottom', 'paddingRight', 'marginTop', 'marginLeft']) {
      const raw = s[p] || '0'
      if (raw.includes('%')) continue
      const v = parseFloat(raw)
      if (v > 0 && v % 4 !== 0) {
        offGrid += 1
        offSamples.add(`${p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
      }
    }
  }
  if (offGrid > 0) add('间距不在 4 网格', `${offGrid} 处，样本 ${[...offSamples].slice(0, 6).join(' ')}`)

  // 3. 圆角种类
  const radii = new Set()
  for (const n of visible) {
    const r = getComputedStyle(n).borderRadius
    if (r && r !== '0px') radii.add(r)
  }
  if (radii.size > 3) add('圆角种类', `${radii.size} 种：${[...radii].join(' ')}`)

  // 4. 前景色种类
  const fg = new Set()
  for (const n of visible) {
    if (!n.textContent?.trim()) continue
    fg.add(getComputedStyle(n).color)
  }
  if (fg.size > 12) add('前景色种类', `${fg.size} 种`)

  // 5. 可点元素的可访问名称
  const clickable = visible.filter(
    (n) => n.tagName === 'BUTTON' || n.tagName === 'A' || n.getAttribute('role') === 'button',
  )
  const nameless = clickable.filter(
    (n) => !n.getAttribute('aria-label') && !n.textContent?.trim() && !n.getAttribute('title'),
  )
  if (nameless.length > 0) add('可点元素无名称', `${nameless.length} 个`)

  // 6. 列表行高一致性
  const rows = visible.filter((n) => n.matches('[data-row], li, .row'))
  const heights = new Set(rows.map((n) => Math.round(n.getBoundingClientRect().height)))
  if (heights.size > 1) add('列表行高不统一', `${heights.size} 种：${[...heights].join(' ')}`)

  // 7. 正文对比度
  // 半透明前景必须先合成到背景上再算，否则 oklab(.../0.32) 会被当成 RGB 读出假数字。
  const blend = (fg, bg) => {
    const fa = Number((fg.match(/\/\s*([\d.]+)\s*\)$/) || [])[1] ?? '1')
    if (fa >= 1) return fg
    const white = /oklab|rgba?\(255, 255, 255/.test(fg)
    if (!white) return fg
    const b = bg.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
    const mix = b.map((v) => Math.round(255 * fa + v * (1 - fa)))
    return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
  }
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  let lowContrast = 0
  for (const n of visible) {
    const text = n.textContent?.trim()
    if (!text || n.children.length > 0) continue
    let bg = null
    let cur = n
    while (cur && cur !== document.documentElement) {
      const s = getComputedStyle(cur).backgroundColor
      if (s && s !== 'rgba(0, 0, 0, 0)' && s !== 'transparent') {
        bg = s
        break
      }
      cur = cur.parentElement
    }
    if (!bg) continue
    const f = lum(blend(getComputedStyle(n).color, bg))
    const b = lum(bg)
    const ratio = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05)
    if (ratio < 4.5) lowContrast += 1
  }
  if (lowContrast > 0) add('正文对比度低于 4.5', `${lowContrast} 处`)

  // 8. 控件高度标尺：按钮只允许 24 / 32 / 40 三档（±1px 抗锯齿误差）
  const ALLOWED_H = [24, 32, 40]
  const strayH = new Map()
  for (const n of clickable) {
    const h = Math.round(n.getBoundingClientRect().height)
    if (h < 18 || h > 56) continue
    if (!ALLOWED_H.some((a) => Math.abs(a - h) <= 1)) {
      strayH.set(h, (strayH.get(h) ?? 0) + 1)
    }
  }
  if (strayH.size > 0) {
    add('控件高度不在标尺上', [...strayH.entries()].map(([h, c]) => `${h}px×${c}`).join(' '))
  }

  return {
    violations: violations.length,
    detail: violations,
    stats: {
      fontSizes: [...sizes].sort(),
      radii: [...radii],
      fgColors: fg.size,
      rows: rows.length,
      /* 供下一轮对比 */
    },
  }
})()
