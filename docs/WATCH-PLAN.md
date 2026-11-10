# B 站客户端计划：把音乐应用扩成「视频 + 听视频」

把 BiliMusic 从音乐播放器扩成一个 B 站桌面客户端，音乐保留成「听视频」模式。一条内容实体，两种看法：看画面，或只听声音。

阅读顺序：先看「保留什么 / 改什么 / 新建什么」三张表，再看九个阶段。每个阶段是一个可独立验收的 PR 单元，带自己的证据。

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## 核心决定：一个实体，两种视图

现在的领域实体是 `Track`（音乐形状）。视频需要更多字段：cid、分P、发布时间、统计、UP 主 mid。

**决定：不新建一套 `Video` 实体。** 把 `Track` 就地扩成 `Media`，保留 `pub type Track = Media` 别名。理由：

- 音乐视图（卡片、播放条、歌词、队列）全部继续编译，零改动
- 「看」和「听」是同一份数据的两种看法，是 UI 状态（`view = watch | listen`），不是领域状态
- 不用维护两套实体之间的同步，也就没有「视频有而音乐没有」的字段漂移

B 站自己也是这么处理的：同一个视频，网页版叫「视频」，App 里有个「听视频」入口。

## 保留什么（不动）

| 模块 | 路径 | 为什么不动 |
|---|---|---|
| 音频引擎 | `crates/audio/` | 时钟、重采样、环形缓冲、断线续传都验证过。这是「听视频」的基础，也是网页版拿不到的能力 |
| 接口地基 | `crates/bili/src/client.rs` | WBI 签名、buvid 指纹、串行闸门、播放专用闸门、5 类错误。踩过 `-412`/`-352`/`-799` 才稳 |
| 本地库 | `crates/store/` | 曲库、历史、反应、歌单、下载、队列快照 |
| 播放编排 | `crates/core/src/engine.rs` | 状态机、队列、进度心跳、结束看门狗、歌词三级回退 |
| 音乐视图 | `features/tracks/`、`features/player/` | 卡片网格、播放条、右栏歌词与队列 |
| 弹幕 | `DanmakuLayer`、`DanmakuStrip` | 车道固定、CSS 自由运动、60fps |
| 列表页 | 搜索、收藏夹、历史、下载、设置 | 收藏夹 636ms、滚动分页、歌词 617ms 都是刚调好的 |
| 视觉体系 | `ui.css`、`2233-*`、图标 | 浅色 B 站主题、官方素材 |

## 改什么（就地改，不重写）

| 位置 | 改法 |
|---|---|
| `crates/model/src/lib.rs` | `Track` → `Media`，加 `aid`、`cid`、`pages`、`published_at`、`stats`、`description`（全部 `Option`，音乐场景为 `None`）。`pub type Track = Media` 保住旧调用点 |
| `crates/model/src/lib.rs` | 新增 `MediaDetail`（aid/cid/pages/stat/owner/pubdate/desc），这是给观看页的完整形态 |
| `crates/bili/src/lib.rs` | `detail()` 返回值升级为领域层 `MediaDetail`；`streams()` 保留现有 durl 分支，新增 DASH 分支 |
| `crates/bili/src/media.rs` | 已经是通用 `Read + Seek`，媒体代理复用它 |
| `crates/core/src/engine.rs` | 新增 `media_detail(key)`、`dash_manifest(key, quality)`；`play_key` 接受可选 `page`（分P 的 cid） |
| `apps/desktop/src/app/appStore.ts` | `View` 加 `{ kind: 'watch'; key: string; page?: number }` |
| `apps/desktop/src/app/ChannelBar.tsx` | 频道项从「搜索/曲库/喜欢/下载/历史/收藏夹/设置」变为「发现/影视/音乐/收藏/历史」 |
| `apps/desktop/src/features/tracks/TrackGrid.tsx` | 卡片点击默认进观看页，播放按钮仍是「听」 |
| `apps/desktop/src-tauri/src/mv.rs` | 泛化成通用媒体代理：任意 URL、透传 Range、注入 Referer/Cookie |

## 新建什么

| 模块 | 职责 | 已探明的依据 |
|---|---|---|
| `crates/bili/src/dash.rs` | playurl 的 `dash` → MPD XML（SegmentBase 模式） | 探针验证：shaka 解析出 5 档、1080p 播放中、切档不中断 |
| `crates/bili/src/comments.rs` | 评论列表与嵌套回复 | 探针：`code 0`，240921 条，首条带 3 条嵌套 |
| `crates/bili/src/feed.rs` | 首页推荐 | 探针：`code 0` 返回 6 条 |
| `apps/desktop/src/features/watch/WatchView.tsx` | 观看页主壳 |  |
| `apps/desktop/src/features/watch/ShakaSurface.tsx` | 播放器封装：挂载、切档、错误回退 |  |
| `apps/desktop/src/features/watch/QualityMenu.tsx` | 画质选择 |  |
| `apps/desktop/src/features/watch/CommentsPanel.tsx` | 评论面板 |  |
| `apps/desktop/src/features/watch/ListenToggle.tsx` | 「听视频」开关，切到现有播放引擎 |  |

## 阶段划分

九个 PR 单元。依赖写在一起，独立的两条可以并行。

### P1 领域实体扩成 Media

**依赖**：无。

**改动**：`crates/model/src/lib.rs`。

**证据**：`cargo test -p bilimusic-model` 全绿；`cargo build --workspace` 通过（证明别名保住了 42 个 bili 方法与 55 个 tauri 命令的调用点）。

**要点**：新字段全部 `Option`；不写 `Default`，避免「空实体」这种非法状态；`MediaDetail` 单独成型，列表项不携带详情。

### P2 DASH 清单生成

**依赖**：P1。

**改动**：新建 `crates/bili/src/dash.rs`，`streams()` 增加 DASH 分支。

**证据**：单测用一条真实 `playurl` 响应做快照，断言生成的 MPD 里 Representation 数量与画质 id 集合；`cargo test -p bilimusic-bili dash`。

**要点**：只挑 `avc1` 编码（webview 兼容性最好），HEVC/AV1 先不选；`SegmentBase` 的 `indexRange` 与 `Initialization` 必须原样带出，这是 shaka 定位分段的前提。

### P3 通用媒体代理

**依赖**：无（可与 P1/P2 并行）。

**改动**：`apps/desktop/src-tauri/src/mv.rs` → `media.rs`。

**证据**：真机打开 MV 仍能播（回归）；`curl` 代理一条 DASH 分片，返回 206 与正确 `Content-Range`。

**要点**：每条请求独立句柄。探针里我踩过共用临时文件导致音视频互相覆盖、MSE append 失败，这个坑必须在 Rust 里避开。

### P4 观看页最小版

**依赖**：P2、P3。

**改动**：`features/watch/WatchView.tsx`、`ShakaSurface.tsx`；`appStore` 加 `watch` 视图；`TrackGrid` 卡片点击进观看页。

**证据（真机）**：搜「周杰伦」→ 点第一张卡 → 1080p 起播，屏幕截图；弹幕层叠在视频上滚动。

**要点**：shaka 从本地打包（不从 CDN 取，桌面端要能离线）；播放器静音时不碰音频引擎，音频引擎只在「听」模式下工作。

### P5 画质菜单与分P

**依赖**：P4。

**证据（真机）**：切 720p 画面继续、不黑屏；切一个多分P 视频的第二个 P，弹幕与进度跟着换。

**要点**：切档用 shaka 的 `selectVariantTrack(track, true)`（探针验证过这个 API 名，v4 里是单数形式）。

### P6 评论面板

**依赖**：P4。

**改动**：`crates/bili/src/comments.rs`、`CommentsPanel.tsx`。

**证据（真机）**：打开一个 24 万评论的视频，首屏有内容，滚动加载第二页，点开一条看嵌套回复。

**风险**：评论接口风控比搜索严。加载失败要有明确降级文案，不能白屏。

### P7 发现页

**依赖**：P4。

**改动**：`crates/bili/src/feed.rs`、频道页。

**证据（真机）**：首页出推荐流，点一条进观看页。

**风险**：这是整套里风控最严的接口。探针只验证了**一次**调用成功，连续刷新的稳定性未证。计划里把它标成「可能降级为分区页」。

### P8 听视频模式

**依赖**：P5。

**改动**：`ListenToggle.tsx`；观看页与现有 `PlayerBar` 打通。

**证据（真机）**：同一个视频，切「听」→ 声音由 Rust 引擎出，歌词与弹幕按音频时钟走；切回「看」→ 画面接上，位置连续。

**要点**：这是整个计划的差异化能力。网页版做不到把音频抽出 webview 单独管，所以这是「比网页版好」的唯一硬理由，不能糊弄。

### P9 播放进度上报

**依赖**：P4。

**改动**：`crates/bili` 加进度上报；`engine` 在进度心跳里调用。

**证据**：播一条视频 30 秒后，B 站网页端的「继续观看」出现这条。

**要点**：上报失败不能影响本地播放，也不能刷屏重试。

## 附录 A：原型证据

**DASH 能不能在我们这套代理下播 1080p**：能。探针写在 `/tmp/dashprobe/probe.py`，本地 8787 端口把 `playurl` 的 dash 转成 MPD，代理转发分片并注入 Referer/Cookie。

实测结果：

```
MPD 解析：5 个档位全部识别
          1080p@5356k / 1080p@2732k / 720p / 480p / 360p
播放：currentTime 持续推进，缓冲 45 秒，分辨率 1920x1080
切档：1080p → 720p 播放不中断、不黑屏、无报错
全程 muted
```

同一探针里踩到的坑：第一版音视频并发拉流共用同一个临时文件，互相覆盖，MSE 报 `CHUNK_DEMUXER_ERROR_APPEND_FAILED`。改成每请求独立句柄后通过。

**接口可用性**（都用当前登录态实测）：

| 接口 | 结果 |
|---|---|
| `playurl` + `fnval=4048` | 15 个视频档位、3 条音轨、3 种编码 |
| `playurl` + `fnval=1` | durl 单文件可用，但最高 720P |
| `view` | aid/bvid/cid/pages/stat/owner/pubdate 齐全 |
| `x/v2/reply` | `code 0`，240921 条，含嵌套回复 |
| `wbi/index/top/feed/rcmd` | `code 0`，6 条 |

## 附录 B：被否掉的方案

**新建独立 `Video` 实体，与 `Track` 并存。** 否掉：两套实体的字段会漂移，音乐视图要重写成两套分支，而且「听视频」需要同一个东西既是视频又是音轨。

**服务端用 ffmpeg 把 DASH 合成单文件再播。** 否掉：起播前要等转码，1080p 一集要几十秒，还不如不做。

**手写 MSE 管线，不用 shaka。** 否掉：要自己实现 sidx 解析、双 SourceBuffer 对齐、切档清缓冲。shaka 已经验证可用，自己写是把已验证的路换成未验证的路。

**直接上 Video.js / hls.js。** 否掉：hls.js 只认 HLS，B 站给的是 DASH。

**Live 直播。** 从范围里去掉：FLV/HLS 另一套协议，与点播不共享任何代码，收益低于成本。

## 附录 C：风险

| 风险 | 落在哪个阶段 | 怎么盯 |
|---|---|---|
| 首页推荐风控（只验过一次调用） | P7 | 若连续刷新出现 `-352`，降级成分区列表；不为此加代理或绕行 |
| 评论接口风控 | P6 | 失败要有明确文案；连续失败停手，不重试 |
| shaka 打包体积 | P4 | 与现在的 .app 体积（54MB）比，涨幅超过 2MB 就换精简构建 |
| 观看页的信息架构 | P4 | 现有「播放条常驻 + 右栏歌词」是音乐优先，观看页需要独立布局，不能硬塞 |
| 账号风险 | 全程 | 第三方客户端调 B 站接口，风控不是零概率。这是操作者自己的判断，计划不掩饰 |
| 分P 的视频 cid 与音频 cid 不一致 | P5 | 播放前用同一个 cid 取 dash；不一致就走分P 自己的 cid |

## 附录 D：还没证明的

- **首页推荐连续刷新的稳定性**。只测了一次。
- **shaka 在 Tauri 的 WKWebView 里的表现**。探针跑在 Chromium 上。WKWebView 的 MSE 支持较新，需要 P4 第一件事就验证；若不可用，退回 `<video>` + durl（720P 上限）或改用原生解码。
- **1080p 的解码开销**。探针没测 CPU。
- **B 站是否对第三方客户端的 DASH 请求额外校验**。目前鉴权就是 Referer + Cookie，但这是观察，不是保证。
