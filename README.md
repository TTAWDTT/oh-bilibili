<p align="center">
  <img src="docs/assets/logo.png" width="88" height="88" alt="oh-bilibili" />
</p>

<h1 align="center">oh-bilibili</h1>

<p align="center">把你自己的 B 站账号内容，放进一个安静的桌面窗口。</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="Rust 1.77+" src="https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-first-000000?logo=apple&logoColor=white" />
</p>

![oh-bilibili 首页](docs/assets/readme-home.jpg)

## 这是什么

一个开源的桌面 B 站客户端。视频和音频都走你自己的 B 站账号，本机直连，不经过中间服务器；界面按 B 站网页端的视觉语言做：浅色底、B 站蓝、封面卡片、分区贴纸、弹幕和三连。

不是内容分发服务，不绕过会员、付费或地区限制，也不做任何变现。

## 现在能做什么

### 发现

轮播加六条推荐、换一换、分区胶囊、正在直播、番剧，以及动画 / 音乐 / 游戏三个分区楼层。桌面上每个楼层是一张跨两行的大卡加右侧四个小卡，窄窗大卡落成一整行 16:9；数据取对应分区的真实排行。

![发现页的分区楼层](docs/assets/readme-floors.jpg)

### 观看

DASH 播放（4K / 1080P+ / 1080P 等），断点续播、倍速、网页全屏和系统全屏，真实弹幕、进度条上方的高能密度条、弹幕显示区域 1/4 / 1/2 / 全屏。三连、投币面板、收藏夹选择、分享、稍后再看、自动连播；右侧是 UP 名片、弹幕列表、合集和相关推荐；评论区带等级牌、粉丝牌、表情和 @ 用户。

![观看页](docs/assets/readme-watch.jpg)

### 动态

关注 UP 的最新投稿，视频、图文九宫格、转发、专栏和直播推荐混排；分类 tab、正文话题标签、转发评论点赞统计，视频卡悬停可以直接「稍后再看」。

![动态页](docs/assets/readme-dynamic.jpg)

### 还有

- **搜索**：综合 / 视频 / UP 主，分区、时长、排序筛选，热搜与输入联想。
- **榜单**：热门、每周必看、入站必刷、排行榜，以及番剧五个分类和追番列表。
- **账号**：关注列表与 UP 空间、消息中心、收藏夹四宫格、历史、喜欢、稍后再看。
- **音乐**：队列、逐字歌词、听视频模式、弹幕舞台。

## 跑起来

前置：Node 22.12+、Rust 1.77+、macOS。

```sh
npm install
npm run dev      # Tauri 桌面窗口
npm run web      # 只调界面：浏览器里跑，内存 mock，不碰真实接口
```

下载功能需要 `yt-dlp`。先运行 `scripts/fetch-yt-dlp.sh` 把它放进 `resources/`；`npm run bundle` 会一并打进 `.app/Contents/Resources/`。开发时也会从工作目录或 PATH 里找。

## 打包

```sh
npm run bundle   # target/release/bundle/macos/oh-bilibili.app，约 46MB
```

`.app` 未签名，首次打开要右键 -> 打开。DMG 在无图形会话的机器上会卡在 Finder AppleScript，这是环境限制，不影响 `.app`。

## 架构

```
apps/desktop  React 19 + Vite + Tailwind，Tauri 命令桥
     │
     ▼
crates/core   播放队列、状态机、业务编排
crates/bili   B 站接口、WBI 签名、cookie 与解析
crates/audio  symphonia 解码 + cpal 输出
crates/store  SQLite（WAL）
crates/model  共享领域类型
```

声音不进 webview：Rust 取流、解码、输出到声卡，界面只发命令收事件。四条规矩：

1. 播放位置的真值只在声卡侧（`Clock` 原子帧计数）。
2. `bili` 的 wire 类型不出适配层。
3. 队列身份是 `EntryId`，不是下标。
4. Rust 与 TS 字段名必须一致，`crates/core/tests/contract.rs` 双向断言。

更细的接口、踩坑和实现记录见 `docs/HANDOFF.md`。

## 验证

```sh
npm run verify     # Rust 测试 + TS 类型 + 浅色主题 + IPC 注册
cargo test --workspace
npm run typecheck -w @bilimusic/desktop
```

需要网络与声卡的真实接口测试：

```sh
cargo test -p bilimusic-bili --test live -- --ignored
cargo test -p bilimusic-core --test live_engine -- --ignored
```

## 边界

- 音源请求从你的电脑直连 B 站，作者服务器不参与。
- 不绕过会员、付费、地区限制；下载只落本机目录。
- 凭据只存本机。写操作（点赞、投币、收藏、关注）走你自己的账号，投币不可逆。
- 登录扫码需要你本人完成，自动化不代替。

## 已知缺口

- 登录后的写操作只在真机手点验证过，没有自动化往返。
- 长时间压测只做过 60 秒内存采样和 5 次切歌，没有连续几小时的观察。
- 窄窗口可用，iOS / Android 尚未打包。
