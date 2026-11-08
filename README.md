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

下载功能需要一个 yt-dlp 可执行文件。放到 `resources/yt-dlp` 即可：

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
cargo test --workspace                 # 离线测试
npm run typecheck -w @bilimusic/desktop

# 需要网络与声卡的真实接口验证
cargo test -p bilimusic-bili --test live -- --ignored --nocapture
cargo test -p bilimusic-core --test live_engine -- --ignored --nocapture
```

## 关于截图

`docs/assets/` 下的界面截图是在浏览器里用内存 mock 数据渲染的，不是 Tauri 真窗口，
所以图里的码率、时长、歌词都来自 `apps/desktop/src/shared/lib/mock*.ts`。
真窗口的视觉效果一致，但数据来源不同。这台机器没有录屏权限，拿不到真窗口截图。

## 已知缺口

- **登录系功能没有真机验证。** 二维码登录、点赞、收藏三条路径写完了，离线测试只覆盖「未登录时被正确挡住」与「二维码能生成」。真账号下的成功路径需要你自己点一遍。
- **内存超预算。** 预算写的 120MB，实测 release 主进程 112MB，加上 WKWebView 的子进程会更高。webview 的基线压不下去，要么调预算，要么换成原生绘制。
- **播放队列不跨重启恢复。** v1 明确的非目标。
- **`cargo public-api` 闸门未接入。** 现在只有依赖方向断言。

## 架构

细节在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，产品计划在 [docs/PLAN.md](docs/PLAN.md)。

三条必须记住的守则：

1. 播放位置的真值只在声卡侧，界面拿到的是投影。
2. wire 类型不出 `bili`，出门只有领域类型。
3. 队列条目的身份是 `EntryId` 不是下标，随机与重排不会互相踩。

## 许可

MIT
