# BiliMusic 交接说明

这份文件写给接手的人（包括未来的我）。它记录当前状态、怎么跑、哪些是坑。

## 一句话现状

能跑通的桌面音乐播放器。搜索、播放、歌单、歌词、弹幕、下载、历史、收藏夹都能用，
UI 按 B 站网页端的视觉语言做（浅色底、B 站粉、封面卡片、分区标签、三连按钮）。

## 怎么跑

```sh
cd bili-music
npm install
export PATH="$HOME/.cargo/bin:$PATH"   # Rust 是 --no-modify-path 装的
npm run dev                            # 开发窗口
npm run bundle                         # 打 .app（约 44MB，含 yt-dlp）
```

只调界面用 `npm run web`（端口 1420，内存 mock，不碰真实接口）。

## 验证

```sh
cargo test --workspace                                    # 18 个测试二进制，全离线
npm run typecheck -w @bilimusic/desktop

# 真实接口（需要网络与声卡）
cargo test -p bilimusic-bili --test live -- --ignored
cargo test -p bilimusic-core --test live_engine -- --ignored
```

## 架构要点

五个 crate，依赖方向由 `crates/core/tests/deps.rs` 用 `cargo metadata` 断言。

```
model  ← bili / store / audio
       ← core ← apps/desktop/src-tauri
```

四条必须遵守的规矩：

1. **播放位置的真值只在声卡侧**（`Clock` 原子帧计数），状态机里没有 position 字段。
2. **wire 类型不出 `bili`**：B 站的 JSON 在适配层内解析成领域类型。
3. **队列身份是 `EntryId` 不是下标**，重排与随机不会互相踩。
4. **Rust 与 TS 字段名必须一致**，`crates/core/tests/contract.rs` 双向断言。

## 已知的坑（都实测过）

| 问题 | 现象 | 处理 |
|---|---|---|
| 图片 CDN 校验 Referer | webview 里封面全部裂图 | `<img>` 必须加 `referrerPolicy="no-referrer"` |
| 视频 CDN 必须带 bilibili Referer | `<video>` 一律 403 | 走本地代理 `mv.rs`，它补 Referer 与 Cookie |
| 弹幕接口返回 deflate 压缩的 XML | 当文本解析得到 0 条 | 先 `flate2` 解压再解析 |
| 音乐区用子分区 id | 按主类目 3 筛得到 0 条 | 音乐 = `3,28,29,30,31,59,130,193,171` |
| `tids` 参数已失效 | 传了直接返回 0 条 | 改为按 typeid 翻页收集 |
| 搜索接口的页面守卫 | 连续请求会被限流返回空 | 保持 1 秒间隔 |
| 端到端测试的等待窗口 | 网络慢时假红 | 等 3 秒、断言位置 > 800ms |

## 被 B 站风控挡住的功能

这两个接口返回 `-352`，不是实现问题：

- 等级徽章：`x/space/wbi/acc/info`
- UP 主的全部投稿：`x/space/*/arc/search`

替代做法：UP 主页改成按作者名搜索（实测 30 条里 29 条同作者）。

## 没验证过的部分

诚实清单：

- **登录系的成功路径**：扫码、点赞、投币、收藏、关注、稍后再看。代码写完了，
  离线只验证了「未登录时正确报 NeedsLogin」。成功路径需要真账号。
- **MV 播放**：本地代理与大阶段都通了，但没在真机上放出来过。
- **真窗口的完整点击流程**：这台机器的 Tauri 窗口有时无法通过辅助功能树访问。

## 视觉规范

见 `apps/desktop/src/styles.css` 顶部的注释：纯中性灰阶、密集排版、单一强调色。
B 站化之后的色值：底 `#f6f7f8`、面板 `#fff`、线 `#e3e5e7`、主色 `#fb7299`。
