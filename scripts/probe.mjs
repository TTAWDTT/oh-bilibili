// 探针：验证 bilibili 网页端接口在无登录态下能否走通「搜索 -> 取流 -> 拉音频」
// 运行: node scripts/probe.mjs
import crypto from 'node:crypto';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const jar = new Map();
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

function baseHeaders() {
  return {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com/',
    Origin: 'https://www.bilibili.com',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: cookie(),
  };
}

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...baseHeaders(), ...(init.headers || {}) },
    redirect: 'manual',
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text: json ? null : text.slice(0, 160) };
}

const mixinKey = (orig) => MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);

function signWbi(params, imgKey, subKey) {
  const mk = mixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const all = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map((k) => {
      const v = String(all[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  const w_rid = crypto.createHash('md5').update(query + mk).digest('hex');
  return `${query}&w_rid=${w_rid}`;
}

const keyOf = (u) => u.split('/').pop().split('.')[0];

async function main() {
  // 0. 先拿 buvid，避免搜索被风控挡掉
  const spi = await call('https://api.bilibili.com/x/frontend/finger/spi');
  const b3 = spi.json?.data?.b_3;
  const b4 = spi.json?.data?.b_4;
  if (b3) jar.set('buvid3', b3);
  if (b4) jar.set('buvid4', b4);
  console.log('[0] spi           ', spi.status, b3 ? 'buvid3 ok' : 'no buvid3');

  // 1. nav -> wbi keys
  const nav = await call('https://api.bilibili.com/x/web-interface/nav');
  const imgKey = keyOf(nav.json.data.wbi_img.img_url);
  const subKey = keyOf(nav.json.data.wbi_img.sub_url);
  console.log('[1] nav           ', nav.status, nav.json.code, `img=${imgKey.length}ch sub=${subKey.length}ch  isLogin=${nav.json.data.isLogin}`);

  // 2. wbi 搜索
  const keyword = process.argv[2] || '周杰伦 晴天';
  const q = signWbi({ search_type: 'video', keyword, page: 1, page_size: 20 }, imgKey, subKey);
  const search = await call(`https://api.bilibili.com/x/web-interface/wbi/search/type?${q}`);
  const results = search.json?.data?.result || [];
  console.log('[2] search        ', search.status, search.json?.code, `hits=${results.length}`, search.text || search.json?.message || '');
  const first = results[0];
  if (!first) return;
  console.log('    first         ', first.bvid, '|', String(first.title).replace(/<[^>]+>/g, '').slice(0, 40), '|', first.duration, '|', first.author);

  // 3. view -> cid
  const view = await call(`https://api.bilibili.com/x/web-interface/wbi/view?bvid=${first.bvid}`);
  const v = view.json?.data;
  console.log('[3] view          ', view.status, view.json?.code, v ? `cid=${v.cid} dur=${v.duration}s pages=${v.pages?.length}` : view.text || view.json?.message);

  // 4. playurl DASH（fnval=16 才是 DASH 分离流）
  for (const fnval of [16, 4048]) {
    const pq = signWbi({ bvid: first.bvid, cid: v.cid, fnval, fourk: 1, platform: 'pc' }, imgKey, subKey);
    const play = await call(`https://api.bilibili.com/x/player/wbi/playurl?${pq}`);
    const dash = play.json?.data?.dash;
    console.log(`[4] playurl fnval=${fnval}`, play.status, play.json?.code, dash ? `audio=${dash.audio.map((a) => a.id).join(',')}` : play.text || play.json?.message);
    if (dash?.audio?.length) {
      const best = [...dash.audio].sort((a, b) => b.bandwidth - a.bandwidth)[0];
      // 5. 带 Referer 拉音频前 64KB，看 CDN 是否放行 + 是否支持 Range
      const r = await fetch(best.baseUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Range: 'bytes=0-65535' },
      });
      const buf = Buffer.from(await r.arrayBuffer());
      console.log(`[5] audio fetch    `, r.status, `bytes=${buf.length}`, `id=${best.id}`, `${Math.round(best.bandwidth / 1000)}kbps`, `mime=${r.headers.get('content-type')}`, `range=${r.headers.get('content-range')}`);
      console.log(`    host           `, new URL(best.baseUrl).host);
      break;
    }
  }

  // 6. 二维码登录是否可生成
  const qr = await call('https://passport.bilibili.com/x/passport-login/web/qrcode/generate');
  console.log('[6] qrcode gen    ', qr.status, qr.json?.code, qr.json?.data?.qrcode_key ? 'ok' : qr.json?.message);
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
