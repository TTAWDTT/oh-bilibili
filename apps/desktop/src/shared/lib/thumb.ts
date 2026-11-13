/**
 * 给 B 站图床地址加缩放后缀。
 *
 * 图床认 `@<宽>w_<高>h_1c.webp`，同一张封面实测 477KB → 22KB。
 * 只对 `iN.hdslb.com` 生效：别的域名不认这套参数，加上去会 404。
 *
 * 比例要跟原图一致（B 站封面基本是 16:9）。请求比原图更宽的比例时，
 * 图床是**补黑边**而不是裁切——首页轮播 8:3 曾因此出现黑边。
 * 需要别的比例就让 CSS 去裁。
 */
export function thumbUrl(url: string | null, width: number, height: number): string | null {
  if (!url) return null
  if (!/^(https?:)?\/\/i[0-9]\.hdslb\.com\//.test(url)) return url
  if (url.includes('@')) return url
  return `${url}@${width}w_${height}h_1c.webp`
}

/** 按 16:9 请求再交给 CSS 裁：封面、头像之外的场景都用这个。 */
export function thumbWide(url: string | null, width: number): string | null {
  return thumbUrl(url, width, Math.round((width * 9) / 16))
}
