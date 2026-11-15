# oh-bilibili 项目计划

开源、可自部署的桌面音乐播放器。音频来自用户自己 B 站账号可访问的视频音轨，本机直连，不经过任何中间服务器。

本文件是项目唯一的计划来源。决策变化先改这里，再改代码。

---

## 1. 定位与红线

红线写进 README 和首次启动提示：

- 不内置服务器中转，音源请求从用户本机直连 B 站
- 不绕过会员、付费、地区限制内容
- 不做内容分发、不做公开音源 API、不做任何变现
- 凭据只存本机，不上传
- 不内置第三方音源插件

下载功能属于本地留存，第一版仅导出到用户指定目录，不提供任何分享通道。

## 2. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 外壳 | Tauri 2 | 用系统 WKWebView，安装包约 12MB，空闲内存远低于 Electron |
| 核心 | Rust | 音频解码与输出需要精确控制，Rust 的 symphonia / cpal / rubato 是现成的最优解 |
| 界面 | React 19 + Vite + Tailwind 4 + zustand | 视觉方向依赖 CSS 能力，webview 里做动态渐变和模糊成本最低 |
| 数据库 | SQLite（rusqlite） | 单文件、可迁移、支持并发读 |
| 下载 | yt-dlp sidecar | 边角情况比自研稳，用户名指定方案 |
| 歌词 | lrclib + B 站字幕 + 本地 lrc | lrclib 实测返回逐字时间轴 |

### 为什么不是 MyGo

MyGo（egoist/mygo，v0.8.3）的指标很好看：约 7MB 二进制、原生 UI 约 44MB 内存、GPU 直接绘制。不选它的原因不是性能，是三点：

1. 0.x 版本，本周仍在改动，长期维护要承担 API 变动风险
2. 原生 UI 模式与视觉方向 A 冲突，动态渐变、背景模糊、逐字歌词动效在自绘 UI 里成本极高
3. 生态太新，遇到问题没有可检索的解法

### 为什么不是 Electron

安装包约 150MB，空闲内存 300MB 以上，与"高性能"目标相反。多打包一个完整 Chromium 换来的只有开发便利，这里不值得。

## 3. 架构

```
┌─ Tauri 2 外壳 ──────────────────────────────────┐
│                                                  │
│  Rust core                                       │
│  ├─ bili/     wbi 签名 搜索 取流 收藏 点赞 二维码  │
│  ├─ audio/    symphonia 解码 -> rubato 重采样     │
│  │            -> cpal 输出（独立线程）            │
│  ├─ download/ yt-dlp sidecar 调度与进度解析       │
│  ├─ lyrics/   三级回退取词                        │
│  ├─ store/    SQLite schema 与仓储                │
│  └─ ipc/      command + event（进度 10Hz）        │
│                                                  │
│  WebView (React)                                 │
│  └─ 只做界面与状态，不碰音频                       │
└──────────────────────────────────────────────────┘
```

关键决定：**音频不进 webview**。Rust 取流、解码、输出到声卡，UI 只发命令收事件。因此没有本地 HTTP 代理、没有 CORS、没有 Range 透传、不受 webview 编解码器限制。

## 4. 目录结构

```
bili-music/
├─ apps/desktop/
│  ├─ src/                  React
│  │  ├─ app/               布局、路由、壳
│  │  ├─ features/          search player library playlist lyrics auth downloads
│  │  └─ shared/            ui 组件、hooks、ipc 封装、设计令牌
│  ├─ src-tauri/            Tauri 外壳（只做窗口与命令注册）
│  └─ index.html
├─ crates/
│  ├─ bili/                 接口适配层
│  ├─ audio/                音频引擎
│  ├─ store/                曲库
│  └─ lyrics/               歌词
├─ docs/PLAN.md
├─ scripts/
│  ├─ probe.mjs             接口回归探针
│  └─ make-icon.py          图标生成
└─ assets/
```

## 5. B 站接口清单

全部集中在 `crates/bili`，接口变动只改这里。

| 用途 | 端点 | 备注 |
|---|---|---|
| 签名密钥与登录态 | `/x/web-interface/nav` | 无登录可通，keys 缓存当日 |
| 设备指纹 | `/x/frontend/finger/spi` | buvid3/buvid4，首启持久化 |
| 搜索 | `/x/web-interface/wbi/search/type` | 必须签名加指纹 cookie |
| 视频详情 | `/x/web-interface/wbi/view` | cid / aid / 时长 / 分区 / 封面 |
| 取流 | `/x/player/wbi/playurl` | `fnval=16` 才是 DASH |
| 字幕 | `/x/player/v2` | 歌词来源之一 |
| 收藏夹列表 | `/x/v3/fav/folder/created/list-all` | 需登录 |
| 建收藏夹 | `/x/v3/fav/folder/add` | 需 csrf |
| 收藏/取消 | `/x/v3/fav/resource/deal` | `rid=aid, type=2` |
| 点赞 | `/x/web-interface/archive/like` | 需 csrf |
| 二维码 | `/x/passport-login/web/qrcode/generate` 与 `poll` | 2s 轮询，180s 过期 |

音轨档位：30216（约 64K）、30232（约 132K）、30280（约 192K）。高码率需登录。播放页如实显示实际码率，不承诺无损。

## 6. IPC 命令表

```
health                       -> 外壳信息
auth.status / auth.qrcode / auth.poll / auth.logout
search.query(q, page)        -> Track[]
track.resolve(bvid)          -> Track + 备选音源
player.play / pause / seek / next / prev / volume / mode
player.state                 -> 播放状态快照
player.events                事件流：progress、track-changed、error
library.playlists / create / rename / delete
library.add-track / remove-track / reorder
library.history
like.set / like.clear
fav.set / fav.clear
sync.pull / sync.push
download.enqueue / cancel / list
lyrics.fetch(bvid, title, artist, duration) -> LyricDoc
settings.get / settings.set
```

事件统一 `{ type, payload }`，前端用 zustand 收敛到单一 player store。

## 7. 数据模型

```
tracks(id, bvid, aid, cid, title, artist, cover, duration,
       raw_title, quality, fetched_at)
playlists(id, name, sort, created_at, updated_at)
playlist_tracks(playlist_id, track_id, sort, added_at)
history(track_id, played_at)
likes(track_id, created_at, remote_state, remote_synced_at)
favs(track_id, folder_id, remote_state, remote_synced_at)
downloads(track_id, path, state, bytes_done, bytes_total, created_at)
auth(mid, uname, avatar, cookies_enc, updated_at)
settings(key, value)
lyrics(track_id, doc_json, source, fetched_at)
```

`remote_state` 取 `pending | synced | failed`。离线操作先落 `pending`，登录后统一推送，失败可见可重试。这是同步逻辑的地基。

## 8. 核心机制

### 8.1 wbi 签名

nav 取 img_key 与 sub_key，用固定 64 位重排表生成 mixinKey，参数按字典序拼接后附 `wts`，与 mixinKey 拼接做 md5 得 `w_rid`。keys 缓存到当日 24 点。

### 8.2 风控

- 首启取 buvid3/buvid4 并持久化，所有请求携带
- 统一 UA、Referer、Origin、Accept-Language
- 全局串行队列：搜索间隔 1s，取流间隔 300ms
- 失败指数退避，连续 412 或 -352 进入冷却并明确提示，不静默重试

### 8.3 音频引擎

独立线程，无 GC 抖动。链路：HTTP 拉流 -> symphonia 解码 -> rubato 重采样到设备采样率 -> cpal 输出。

首版实现：播放、暂停、seek、上下曲、音量、循环模式。
预留接口：无缝衔接、淡入淡出、EQ、响度归一化。

切歌优化：队列里下一首的音频 URL 提前解析，切歌时只做解码器切换。

### 8.4 歌曲到视频映射

MVP 打分：

```
标题匹配 0.40 + 时长合理性 0.20 + 分区为音乐 0.15
+ UP 主历史命中 0.15 + 播放量归一化 0.10
```

负向过滤：标题含鬼畜、教程、搬运、合集、直播回放降权；时长小于 60 秒或大于 12 分钟降权；同 UP 主重复投稿合并。

后续：本地映射表加手动换源，换源结果反写。

### 8.5 喜欢与收藏

- 喜欢 对应 B 站点赞
- 收藏 对应收藏夹「哔哩哔哩 music」，不存在则自动创建
- 游客也能操作，只落本地并标 `pending`
- 登录后双向合并：本地 pending 推上去，远端新条目拉下来
- 批量推送必须限速

### 8.6 下载

yt-dlp sidecar，随包分发，约 30MB。

- cookie 从凭据存储导出临时文件，用完即删
- 纯音轨，不需要 ffmpeg 合并
- 输出到用户设定目录，文件名模板 `歌手 - 歌名.m4a`
- 并发 1，带进度事件，失败重试 2 次
- 下载完成后写入 `downloads` 表，本地文件优先于在线流

### 8.7 歌词

三级回退：本地 lrc -> lrclib -> B 站字幕。

lrclib 实测返回 `hasWordSync: true`，可做逐字高亮。查不到时显示纯文本，不阻塞播放。解析结果按 track 缓存进 `lyrics` 表。

## 9. 视觉规范（方向 A 深空色晕）

### 色板

| 令牌 | 值 | 用途 |
|---|---|---|
| ink | #050507 | 底色 |
| surface | rgba(255,255,255,0.045) | 玻璃卡片 |
| surface-strong | rgba(255,255,255,0.09) | 选中态 |
| hairline | rgba(255,255,255,0.09) | 分隔线 |
| text-1 | rgba(255,255,255,0.92) | 主文本 |
| text-2 | rgba(255,255,255,0.46) | 次文本 |
| text-3 | rgba(255,255,255,0.25) | 标签 |
| magenta | #FF3D81 | 主强调 |
| violet | #7C4DFF | 次强调 |
| cyan | #00E5FF | 完成态、进度 |

封面主色由 Rust 侧提取后回传，作为动态色晕的输入，同一首歌的底色随封面变化。

### 排版

- 展示级 56/1.04，字重 600，字距 -0.03em
- 段落 40 与 22，正文 14，行距 1.6
- 元信息 13，标签 11 加 0.18em 字距
- 数字与时间统一等宽字体

### 动效

- 通用过渡 240ms，缓动 cubic-bezier(0.22, 1, 0.36, 1)
- 色晕 26s 与 34s 交错漂移，禁止同时到达极值
- 逐字歌词按主色渐变扫过，滚动居中带惯性
- 列表 hover 只动背景透明度与反向 2% 缩放，不动布局

### 组件清单

TrackRow、CoverArt（带光晕）、PlayButton、SeekBar、VolumeBar、PlaylistCard、SearchField、QrLoginPanel、LyricScroller、EmptyState、Skeleton、Toast。

## 10. 里程碑与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 侦察 | 接口连通性、风控形态、音源可拉性 | 探针脚本跑通 |
| M1 外壳 | Tauri 窗口、IPC、深空底、图标 | 窗口可开，`health` 返回，界面无报错 |
| M2 搜索与登录 | wbi、指纹、二维码、结果清洗与打分 | 搜「晴天」前 5 条含原曲 |
| M3 播放引擎 | 解码、输出、seek、队列、预取 | 连听 10 首不断流，拖动立即响应 |
| M4 曲库与同步 | SQLite、歌单、历史、喜欢、收藏 | 点红心后 B 站网页可见，取消后消失 |
| M5 歌词与下载 | 三级回退、逐字高亮、yt-dlp | 歌词跟得上，下载文件可离线播放 |
| M6 界面 | 全部页面按视觉规范实现 | 主路径无报错，空态错误态齐备 |
| M7 打包开源 | dmg、签名公证说明、README、LICENSE | 别人照 README 能跑起来 |

## 11. 性能预算

| 指标 | 目标 |
|---|---|
| 冷启动 | < 800ms |
| 空闲内存 | < 120MB |
| 切歌间隔 | < 150ms |
| 万首列表滚动 | 稳定 60fps |
| 安装包 | 约 12MB（不含 yt-dlp），含 yt-dlp 约 50MB |
| 后台常驻 CPU | 空闲约 0% |

## 12. 风险

| 风险 | 对策 |
|---|---|
| 搜索接口风控升级 | 适配层隔离，指纹 cookie，限速；必要时回退网页搜索解析 |
| 取流被拦或需登录 | 优先登录态，游客档位明确降级 |
| 音质上限约 192K | 如实显示码率，不承诺无损 |
| 映射不准 | 打分加负向词加手动换源 |
| wbi 或端点变动 | 集中在两个文件，改一处 |
| 版权争议 | 只做本机直连播放，README 与首启提示写清用途 |

## 13. 已定决策

| 项 | 决定 |
|---|---|
| 定位 | 开源，别人自己部署 |
| 平台 | 桌面端，macOS 优先 |
| 框架 | Tauri 2 + Rust 音频引擎 + React |
| 视觉 | **已变更**：原定方向 A 深空色晕，实际改成 B 站网页端的浅色主题（详见「视觉规范」） |
| 下载 | 要，用 yt-dlp |
| 歌词 | 进第一版；实现为本地 .lrc → lrclib → B 站字幕三级回退 |
| 喜欢 | 对应 B 站点赞 |
| 收藏 | 可自选收藏夹；不选时收进「哔哩哔哩 music」，不存在就自动创建 |
| 账号 | 不做多账号切换，但支持登出后登录别的账号 |
