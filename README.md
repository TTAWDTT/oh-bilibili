# oh-bilibili

一款适用于 macOS 和 Windows 的第三方哔哩哔哩客户端。打开首页刷推荐，点进投稿看视频和弹幕，也能在「动态」里看到关注的 UP 主刚发的作品。

| 平台 | 安装包 | 安装方式 |
| --- | --- | --- |
| macOS · Apple 芯片 | [下载 v0.1.0（ZIP）][mac-download] | 解压后将 `oh-bilibili.app` 拖到「应用程序」。首次打开若提示无法验证开发者，可查看 [Apple 的打开说明](https://support.apple.com/zh-cn/102445)。 |
| Windows · x64 | [下载 v0.1.2（EXE）][win-download] | 双击安装到当前用户。若缺少 WebView2，安装程序会联网获取。 |

两个安装包均未签名，发布页提供 SHA-256 校验文件。[Mac 发布说明][mac-release] · [Windows 发布说明][win-release]

Windows v0.1.2 已包含下文介绍的新版时间轴、窄窗音量和私信。macOS v0.1.0 发布较早，在 Apple 芯片设备上体验这些功能可以[从源码运行](#从源码运行)。

![Mac 版发现页，左侧是频道导航，右侧是推荐视频的封面](docs/assets/readme-home.jpg)

## 找到想看的投稿

打开「发现」时，「全部」只展示首页推荐。想专看某个分区，就点「音乐」「舞蹈」等标签。点开「全部分区」里的「编辑常用」，可以把常看的分区放在最前面，也可以加上或移除分区。

按 `⌘K`（Windows 用 `Ctrl+K`）可以在顶栏搜视频和 UP 主。从结果点进投稿，返回时会回到刚才那张卡片。也可以直接粘贴带 BV 号的视频网址。链接以 `?p=2&t=75` 结尾，作品会从第 2 P 的 1:15 开始播放。直播和番剧各有浏览入口，选中后会在系统浏览器打开。

## 看视频

- **找片段。** 拖动进度条可以预览画面和落点时间，有章节的投稿还会显示章节名。上方的灰白色短柱表示弹幕热度，指向一段能看到那里的弹幕，也能从那里开始播放。
- **看弹幕。** 默认只占画面顶部四分之一。在视频下方可以一键开关，也可以改成半屏或全屏。
- **追多 P 和合集。** 在选集目录切换分 P，或从合集打开下一期。评论笔记里标了分 P 的时间点也可以直接跳转。
- **给 UP 主三连。** 长按点赞键，一次完成点赞、投币和收藏。想留到以后看，可以选一个收藏夹，或加入「稍后再看」连续播放。

窄窗口里仍能看到总时长，把鼠标移到喇叭上就能调音量。用键盘看视频时，空格播放或暂停，`←` / `→` 快退或快进 5 秒，`D` 开关弹幕，`M` 静音。按 `W` 让视频铺满当前窗口，按 `F` 进入系统全屏。

## 账号与收藏

用哔哩哔哩手机版扫码登录后，可以查看自己的收藏夹、历史和稍后再看。从 UP 主空间能浏览对方公开的置顶投稿、代表作和合集，也可以点「发消息」写文字私信，在消息中心接着聊。登录凭据保存在本机，视频清晰度和可观看内容取决于 B 站对当前账号的授权。

收藏夹里的投稿可以按「播放全部」连续听。看访谈或音乐现场时，也可以从观看页点「听视频」，切回画面时会接着当前分 P 的进度播放。音频支持下载到本机。

## 从源码运行

准备 Git、Node.js 22.12 或更新版本，以及 Rust stable。macOS 需要 Xcode 命令行工具。Windows 需要 Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载、Windows SDK 和 WebView2。安装步骤见 [Tauri 开发环境指南](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone https://github.com/TTAWDTT/oh-bilibili.git
cd oh-bilibili
npm ci
```

进入仓库目录后，按平台准备音频下载工具 yt-dlp，再启动桌面客户端。

| 平台 | 准备 yt-dlp | 启动 |
| --- | --- | --- |
| macOS | `sh scripts/fetch-yt-dlp.sh` | `npm run dev` |
| Windows x64 | `npm run fetch:yt-dlp:windows` | `npm run dev` |

- `npm run web` 在浏览器中用模拟数据预览界面，只需安装 npm 依赖。
- `npm run verify` 运行 Rust 测试、TypeScript 类型检查，以及界面和接口检查。线上接口另用专用测试账号验证。将 `BILIMUSIC_LIVE_COOKIES` 指向该账号的 Cookie 文件后，运行 [`scripts/live-test.sh`](scripts/live-test.sh)。
- `npm run bundle` 构建本机安装包。Mac 应用位于 `target/release/bundle/macos/`，Windows 安装程序位于 `target/release/bundle/nsis/`。

界面使用 React 和 Tauri，Rust 负责取流、音频解码和播放，SQLite 保存本地数据。[项目架构](docs/ARCHITECTURE.md) · [视频播放设计](docs/ARCH-WATCH.md)

侧栏的小电视、纸飞机和信封来自这套项目自制的贴纸图标，也可以单独下载使用。[咔嗒 · Kada Icons](https://github.com/TTAWDTT/kada-icons)

[mac-download]: https://github.com/TTAWDTT/oh-bilibili/releases/download/v0.1.0/oh-bilibili-0.1.0-macos-arm64.zip
[win-download]: https://github.com/TTAWDTT/oh-bilibili/releases/download/v0.1.2/oh-bilibili-0.1.2-windows-x64-setup.exe
[mac-release]: https://github.com/TTAWDTT/oh-bilibili/releases/tag/v0.1.0
[win-release]: https://github.com/TTAWDTT/oh-bilibili/releases/tag/v0.1.2
