# BiliMusic

开源桌面音乐播放器。音频来自你自己的 B 站账号可访问的视频音轨，本机直连，不经过任何中间服务器。

界面是深空色晕方向：纯黑底、封面主色驱动的光晕、玻璃卡片、逐字歌词扫色。

## 这是什么，不是什么

**是**：一个把 B 站内容当作音源的本机播放器。搜索、播放、歌单、歌词、下载、喜欢、收藏都在本地完成。

**不是**：内容分发服务、公开音源 API、付费产品的替代品。它不内置任何中转服务器，也不绕过会员或地区限制。

## 红线

- 音源请求从你的电脑直连 B 站，作者服务器不参与
- 不绕过会员、付费、地区限制内容
- 不做内容分发，不提供公开接口，不做任何变现
- 凭据只存你的本机

下载功能只导出到本机目录，不提供任何分享通道。请自行确认你对所听内容有合法访问权。

## 技术栈

| 层 | 选择 |
|---|---|
| 外壳 | Tauri 2（系统 WKWebView，不打包浏览器） |
| 核心 | Rust，五个 crate：model / bili / store / audio / core |
| 音频 | symphonia 解码 + 重采样 + cpal 输出，跑在独立线程 |
| 界面 | React 19 + Vite + Tailwind 4 + zustand |
| 存储 | SQLite（rusqlite，WAL） |
| 下载 | yt-dlp sidecar |

音频**不进 webview**：Rust 取流、解码、输出到声卡，界面只发命令收事件。所以没有本地 HTTP 代理，没有 CORS，也不受 webview 编解码器的限制。

## 跑起来

前置：Node 22+、Rust 1.77+、macOS（Linux 与 Windows 未经测试）。

```sh
npm install
npm run dev          # 起 Tauri 开发窗口
```

只调界面（浏览器里跑，用内存 mock，不碰真实接口）：

```sh
npm run web
```

下载功能需要一个 yt-dlp 可执行文件。源码树里放 `resources/yt-dlp`；**打包后的 `.app` 不认这个路径**，
要么把它放进 `BiliMusic.app/Contents/MacOS/resources/`，要么装到 PATH 里（brew 或 pip 都行）。

```sh
curl -L -o resources/yt-dlp \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
chmod +x resources/yt-dlp
```

## 打包

```sh
npm run bundle        # 产出 target/release/bundle/macos/BiliMusic.app，约 8.5MB
```

`.app` 未经签名，首次打开要右键 -> 打开。dmg 打包在本机无图形会话时会卡在 Finder AppleScript
超时，这是环境限制，不影响 `.app` 本身。

## 验证

```sh
cargo test --workspace                 # 离线测试，18 个测试二进制
npm run typecheck -w @bilimusic/desktop
npm run ui:audit                       # 浅色主题一致性检查（深底深字、悬停隐字等）

# 需要网络与声卡的真实接口验证
cargo test -p bilimusic-bili --test live -- --ignored --nocapture
cargo test -p bilimusic-core --test live_engine -- --ignored --nocapture
```

## 关于截图

`docs/assets/` 下有两类图：

- `ui-real-*.png`、`ui-mv-playing.png`、`ui-download-*.png` 等是 **Tauri 真窗口截图**，
  数据来自 B 站真实接口（例如真机搜索「周杰伦」返回 29 条、播放页显示真实弹幕与歌词）。
- 其余多在浏览器里用内存 mock 渲染，图里的码率、时长、歌词来自
  `apps/desktop/src/shared/lib/mock*.ts`。

真窗口截图用 `screencapture` 抓取，配合 `agent-desktop` 做点击与输入。

## 已知缺口

- **登录系的成功路径没有真账号验证。** 扫码登录、点赞、投币、收藏、关注、稍后再看
  六条写入路径的代码与错误分支都完成了，离线测试覆盖「未登录时正确报 NeedsLogin」
  与「点赞/收藏/投币状态能读回并回滚」。成功路径需要你自己点一遍。
- **UP 主的全部投稿拿不到。** `space/arc/search` 需要登录会话，未登录返回 -412/-403。
  UP 主页现在展示的是「按作者名搜索」的结果，并明确标注「下方仅显示搜索结果里的 N 个」。
- **`cargo public-api` 闸门未接入。** 现在只有依赖方向断言（`crates/core/tests/deps.rs`）
  与 Rust↔TS 字段契约（`crates/core/tests/contract.rs`）。

## 已完成的验证（这些曾经是缺口）

| 项 | 状态 |
|---|---|
| 队列与播放位置跨重启恢复 | ✓ 快照存完整曲目 + 下标 + 位置，播放中每 5 秒落盘；重启后点播放从原位置续 |
| 歌词三级回退 | ✓ 本地 `.lrc` → lrclib → B 站字幕；同歌 6 条不同标题实测命中 6/6 |
| MV 播放 | ✓ 真机播出官方 MV（曾因 CSP 的 `media-src` 未放行本地代理而失败） |
| 内存 | ✓ 主进程空闲 76MB、播放中 91–93MB，低于 120MB 预算；切歌 5 次后 100MB |
| 下载端到端 | ✓ 真机点卡片下载 → yt-dlp → 落盘约 6.4MB m4a |
| 键盘可达性 | ✓ 焦点环、弹窗焦点陷阱、跳到主内容、页面 h1 与不跳级的标题层级 |

## 架构

细节在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，产品计划在 [docs/PLAN.md](docs/PLAN.md)。

三条必须记住的守则：

1. 播放位置的真值只在声卡侧，界面拿到的是投影。
2. wire 类型不出 `bili`，出门只有领域类型。
3. 队列条目的身份是 `EntryId` 不是下标，随机与重排不会互相踩。

## 许可

MIT
