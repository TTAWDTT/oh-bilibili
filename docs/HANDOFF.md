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
| ~~`tids` 参数已失效~~ | **这条结论是错的**：当时返回 0 条其实是撞上限流 | `tids` 传一级分区 id 完全有效（音乐 3、游戏 4），已改回服务端过滤 |
| 搜索接口的页面守卫 | 连续请求会被限流返回空 | 保持 1 秒间隔 |
| 端到端测试的等待窗口 | 网络慢时假红 | 等 3 秒、断言位置 > 800ms |

## 接口可用性的实测结论

早期这里记着「被风控挡住」，后来重验发现大部分是误判。当前实测：

| 接口 | 状态 | 说明 |
|---|---|---|
| `x/web-interface/card?mid=` | ✅ 可用 | UP 主粉丝数、签名、认证。不需要登录，不需要 wbi |
| `x/relation/stat?vmid=` | ✅ 可用 | 关注数、粉丝数 |
| 搜索 `tids=` | ✅ 可用 | 一级分区过滤 |
| `x/space/wbi/acc/info` | ⚠️ -352/-799 | 等级徽章仍拿不到；`card` 里没有 level 字段 |
| `x/space/arc/search`（无 wbi） | ⚠️ -412 | 缺 buvid 指纹时被 ban；带上 buvid 变 -799 限流 |
| `x/space/wbi/arc/search` | ⚠️ -403 | 访问权限不足，需要登录态 |

**教训**：撞到限流返回的空结果，很容易被当成「接口失效」。
下结论前应该换一组参数、等一会再试一次，或者换个等价接口。

## 没验证过的部分

诚实清单：

- **登录系的成功路径**：扫码、点赞、投币、收藏、关注、稍后再看。代码写完了，
  离线只验证了「未登录时正确报 NeedsLogin」。成功路径需要真账号。
- **MV 播放**：本地代理与大阶段都通了，但没在真机上放出来过。
- **真窗口的完整点击流程**：这台机器的 Tauri 窗口有时无法通过辅助功能树访问。

## 视觉规范

见 `apps/desktop/src/styles.css` 顶部的注释：纯中性灰阶、密集排版、单一强调色。
B 站化之后的色值：底 `#f6f7f8`、面板 `#fff`、线 `#e3e5e7`、主色 `#fb7299`。
