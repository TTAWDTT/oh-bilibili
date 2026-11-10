# 视频 + 听视频的架构设计

把现有音乐播放器扩成 B 站桌面客户端。一条内容实体 `Track` 不动，新增一个可选的画面出口。

## Problem

现有系统有三条硬约束，它们让形状不是随便挑的。

音频永远不进 webview。`symphonia` 解码，重采样，`cpal` 输出。这是「听视频」能存在的前提，也是网页版给不了的东西。位置的唯一真值是声卡侧的 `Clock` 帧计数，界面只有 10Hz 外推。

界面与 Rust 的字段契约由 `crates/core/tests/contract.rs` 强制。`Track` 已经被 52 个 ipc 函数与 55 个 tauri 命令穿过，改动它会同时动到搜索、收藏夹、历史、下载、队列、歌词六套界面。

这个仓库刚花了很多轮把音乐链路稳住。收藏夹 636ms、歌词 617ms、弹幕 60fps、时钟比值 0.994。任何设计如果要求重写 `engine.rs` 的状态机，就是把已验证的东西换成未验证的东西。

两个新事实决定了画面那一侧怎么落地。

DASH 分段来自 24 个不同主机，含第三方 PCDN `edge.mountaintoys.cn`。现有代理的白名单只放行 `bilivideo.com`，所以按域名写白名单必然失效。

B 站的分段地址是同一条 URL 加 Range，靠 `SegmentBase` 的 `indexRange` 定位。原型已经证明本地代理加合成 MPD 加 shaka 能播 1080p，切档不黑屏。

## Usage（调用方的视角）

界面上只有三个动作需要新接口。

```rust
// 卡片上按「看」，进观看页
let view = engine.open_watch(&bvid, None).await?;
// view.manifest 是 http://127.0.0.1:端口/m/s7 这样的本机句柄
// view.qualities 是可用档位，view.pages 是分P 列表，view.stats 是播放量收藏数

// 观看页选了 720P
let view = engine.set_watch_quality(VideoRate::P720).await?;
// 返回新的句柄，旧句柄还有效直到会话结束

// 按「听视频」，切到音频引擎
engine.set_mode(PlayMode::Listen)?;
// snapshot.mode 变成 listen，位置不变，因为位置从来不在会话里
```

前端拿到的东西里没有任何远端地址。

```ts
type WatchView = {
  manifest: string          // 本机句柄，不是 B 站地址
  qualities: { rate: VideoRate; label: string; active: boolean }[]
  pages: { no: number; title: string; durationMs: number }[]
  currentPage: number
  stats: { views: number; danmaku: number; like: number; coin: number; favorite: number }
  audioKbps: number | null
}
```

## Shape

### 内容实体不动

`Track` 一个字段都不加。理由是分P、画质阶梯、统计这些只在一次会话里有意义，放进实体等于让每个列表项替会话背债。搜索返回 30 条时，其中 29 条永远用不到 `pages`。

「看」与「听」不是两个实体，也不是两个能力。它们是同一个会话的两个目标状态。差异只是一个可空字段 `picture`。

这条决定用 `principle-laziness-protocol`，也是三个候选的实体方案里改动最小的一个。

### 一个可空字段作为唯一分叉

```rust
/// 观看会话。看与听共享它，差别只有 picture 是否为空。
pub struct WatchView {
    pub media: MediaRef,          // bvid 加当前分P 的 cid
    pub picture: Option<Picture>, // 空 = 听模式
    pub qualities: Vec<QualityOption>,
    pub pages: Vec<PageRef>,
    pub current_page: PageRef,
    pub stats: Stats,
    pub audio_kbps: Option<u16>,
}

/// 画面的投递方式。两种都在，不给第三个变体留位置。
pub enum Picture {
    /// 音视频分离的 DASH，只有视频轨。
    Dash { handle: StreamHandle, rate: VideoRate },
    /// 单文件 mp4，用于取不到 DASH 时的降级。
    Progressive { handle: StreamHandle },
}
```

`StreamHandle` 是一个不透明字符串，形如 `s7`。它只能由引擎铸造，前端拿不到也造不出远端地址。

### 代理换成票据，不再按域名放行

现有 `mv.rs` 收 `?u=<完整地址>` 并按 `url.contains("bilivideo.com")` 放行。这个设计有两个问题。第一，DASH 主机里有一半不在 `bilivideo.com`，白名单必然漏。第二，域名白名单是「手工同步的清单」，加一个 CDN 就要改一处代码。

改成票据。

```rust
/// 谁能被代理的唯一决定处。
pub struct HandleTable {
    live: Mutex<HashMap<StreamHandle, Minted>>,
}

struct Minted {
    url: String,
    /// 只允许同一个会话再兑换，防止句柄被别的会话拿去用。
    session: SessionId,
    minted_at: Instant,
}

impl HandleTable {
    /// 铸造一张票。url 从 playurl 响应里来，别处不铸造。
    pub fn mint(&self, session: SessionId, url: String) -> StreamHandle { unimplemented!() }
    /// 代理收到请求时兑换。过期或会话不符就 404。
    pub fn redeem(&self, handle: &StreamHandle, now: Instant) -> Option<String> { unimplemented!() }
}
```

代理只认 `/m/<handle>`，不再接受任何 URL 参数。这一处改动同时解决三个问题。第三方 CDN 自动可用，不再有域名清单，也不会变成开放代理。

顺带堵掉一个现有口子。`mv.rs` 的路径是 `/p?u=<地址>`，只要域名含 `bilivideo.com` 就放行，所以任何拿到本机端口的人都能拿它代理 bilivideo 上的任意资源。票据把这个入口整个去掉。

这条用 `principle-encode-lessons-in-structure`。原型的教训是音视频并发拉流共用临时文件导致 MSE 失败，票据设计里没有临时文件，也就没有这个失败面。

### 只给视频轨的 MPD

看模式下 webview 走 DASH 播画面，音频仍由 Rust 引擎出声。所以合成的 MPD 里只有 `AdaptationSet contentType="video"`。

三条收益。视频元素根本没有音轨，不会出现两路声音。不重复解码一份音频。切到听模式只是把画面卸掉，声音一路没断过。

```rust
/// 只接受视频轨，音轨在类型上写不进来。
pub fn to_mpd(video: &[VideoStream], duration: Millis, handle_of: impl Fn(&str) -> StreamHandle) -> String {
    unimplemented!()
}
```

`to_mpd` 的参数类型是 `&[VideoStream]`，而 `VideoStream` 只能从 `playurl` 的 `dash.video[]` 产生。音轨进不来这件事由类型保证，不靠注释。

### 看听切换的位置不变

位置不在会话里。`set_mode` 只做两件事，挂上画面或卸下画面。它不重新加载音频，也不 seek。

```rust
impl Engine {
    pub fn set_mode(&self, mode: PlayMode) -> PlayerSnapshot { unimplemented!() }
}
```

从听切到看，画面挂载时把 `video.currentTime` 对到 `Clock` 的当前读数。从看切到听，画面卸掉，声音一路继续。位置因此天然连续，不需要在两个地方各存一份再同步。

### 音画漂移由一个小策略管，不是一条状态机

候选 C 指出的真实风险是画面是唯一不受控的执行者。窗口切到后台时 `requestAnimationFrame` 停下，画面与声音脱节。

处理方式保持小。一个策略结构，一处判定。

```rust
/// 画面跟随声音的策略。只有数据，没有状态机。
pub struct DriftPolicy {
    /// 偏差超过这个值就拉回。
    pub tolerance: Millis,
    /// 多久没收到画面汇报就认为画面丢了。
    pub silence_timeout: Millis,
}

impl DriftPolicy {
    /// 返回 None 表示不用动。
    pub fn correction(&self, audio: Millis, video: Millis) -> Option<Milli> { unimplemented!() }
    /// 画面汇报断流太久了。
    pub fn surface_lost(&self, last_report: Instant, now: Instant) -> bool { unimplemented!() }
}
```

心跳用 `setInterval` 加 `visibilitychange` 兜底，不依赖渲染帧。窗口回到前台时先等一帧真实读数再判偏差，避免拿一个陈旧的读数额外跳一次。

画面丢了的处理是 `picture` 变空，退回听模式。会话不重建，声音不断。

### 契约补齐，不再单方向

现有契约测试是单向的。Rust 发的字段在 TS 里找不到会红，TS 声明了 Rust 永不发的字段却全绿。而且 `AppEvent::Download` 用 `serde_json::Value` 整块绕过了检查，这一点我核实过，`crates/core/src/wire.rs` 第 181 行就是。

三处改动。

1. 断言双向。每个界面类型在两边的字段集合必须相等。
2. 样本由一个 `sample()` 函数产生，测试与界面用同一份，避免第三份手抄清单。
3. `wire.rs` 里禁止 `serde_json::Value` 作为事件载荷，`Download` 改成明确的 `DownloadView`。

这条用 `principle-boundary-discipline`。契约是边界，边界上的检查必须覆盖两个方向。

### 接口深度

前端只能看到 `open_watch`、`set_watch_quality`、`set_mode` 三个动作，和一个不含任何远端地址的 `WatchView`。

被藏起来的东西有六件。playurl 的调用与参数、DASH 档位的挑选与编码偏好、MPD 的合成、票据的铸造与过期、代理的白名单判定、以及「取不到 DASH 时降级到单文件」。

这六件全部在 Rust 侧，前端改不了也绕不过。

## Synthesis decision

基础是候选 B，能力优先。

选 B 的理由是它改动最小而接口最深。它对 `Track` 一个字段都不加，于是六套既有界面和 107 个命令不受影响。它把看与听的差异收敛成一个可空字段 `picture`，把远端地址从 wire 上彻底拿掉。这两点合起来，让「加视频」变成「加一个可选出口」，而不是「换一套实体」。

从候选 A 取两样。

`MediaRef { bvid, page, cid }` 的类型约束。没有 cid 就要不到流，这件事变成类型事实。A 的完整做法是把它放进实体，我把它缩小成会话内的引用，既拿到了约束又不让列表项背债。

契约由声明派生的思路。A 提议 `#[derive(UiContract)]` 加一个新 crate。这个正确但过重，我取它的判断，用候选 B 找到的具体缺口做轻量修法，也就是双向断言加样本函数加禁用 `serde_json::Value`。

从候选 C 取一样。

画面漂移的处理。C 的完整方案是一条 `Pipeline` 状态机，九个迁移函数。我判断那是按执行顺序切分模块，会把同一份播放知识散到多处。我只取它的 `SyncPolicy` 与「汇报断流即降级」这两个判断，缩成 `DriftPolicy` 一个纯数据加两个纯函数，放在画面那一层，不进引擎状态机。

没取的。

候选 A 的 `Session` 加减速器 `step` 加 `Effect` 整套重写。它会让 `engine.rs` 里的状态机从头再来一次，而这些行为是刚验证过的。

候选 C 的 `Pipeline` 全量迁移表。理由同上。

候选 B 建议删掉 `MvOverlay` 并改用 `Picture::Progressive`，这一条我采纳了，写进模块图。

## Tradeoffs accepted

我们在看模式下多解码一次视频轨，换取音频永远只有一个发声者。视频元素没有音轨，所以不可能出现两路声音。

我们把「哪张票对哪个会话」存在内存里，换取代理没有开放的 URL 入口。代价是应用重启后旧句柄失效，观看页需要重新打开。

我们让画面跟随声卡时钟，接受网速慢时画面会被反复拉回。策略里用 250ms 容差压低这种观感伤害，但它不消失。

我们不在 `Track` 上加 `pages`，接受卡片上看不到分P 数量。要看分P 就进观看页。

我们在契约测试里加手工的样本函数，接受多写一处。它换来的是两个方向都被检查。

## Alternatives considered

两个实体，`Track` 与 `Video` 并存。它失在接口深度，调用方要自己决定拿哪个实体，还要维护两者之间的断点同步规则。持久层里一条 bvid 只占一行，两个实体意味着同一内容在收藏里出现两次。

按能力划分模块，每个能力一个小接口加一个会话视图。它的公开面更宽，观看页要协调四五个接口才能凑出一个屏幕。收敛成一个 `WatchView` 之后，前端只调一次。

按播放管线划分，用 `Pipeline` 状态机表达所有迁移。它的九条迁移把同一份知识摊开，读代码的人要在文件之间来回。漂移那部分我按这条思路取了一个策略，其余拒绝。

在服务端用 ffmpeg 把 DASH 合成单文件。起播要等转码，1080p 几十秒，等于不可用。

## Open questions and risks

shaka 在 Tauri 的 WKWebView 里表现如何。原型跑在 Chromium 上。这条要在第一件事就验，不通过就退回 `Picture::Progressive`，画质上限 720P。

首页推荐接口只测过一次调用。连续刷新会不会撞风控，还不确定。它不影响这个架构，但会影响发现页能不能做。

1080p 的解码开销没测。若在高码率下掉帧，`Quality::P1080` 要设一个默认上限。

分P 的每个 P 有独立的 cid，弹幕也按 cid 分开。切换分P 时队列里的「当前项」该怎么算，是替换还是新增，需要你定一个说法。

账号风险。这是第三方客户端调 B 站接口，风控不是零概率。这个决定在你。

## Next implementation step

先做票据代理与 `to_mpd`，用原型验证过的输入在 Rust 侧跑通，拿到一条能播 1080p 的本机句柄。它是所有后续工作的地基，也是唯一能在没有界面的情况下独立验证的一步。

## 实现前必须修的现有缺陷

读代码时发现一处真实的顺序错误，`crates/core/src/engine.rs` 的 `fetch_and_load`。

函数收下 `LoadToken` 参数，然后在第 338 行写 `let _ = token;`，从头到尾没用过它。音频文件的 `player.load()` 在第 318 行就已经执行了。

后果是两次打开交错时，慢的那次解析完照样把字节塞给声卡。扬声器在放 A，状态说当前是 B。这个错误不影响测试，只影响听感，所以一直没被发现。

修法很小。`load` 之前判一次 token，`load` 之后再用时钟代数判一次，两次都过才认。这条我单独做成第一个提交，因为它与视频无关，先修掉能让后面的调试不被它干扰。

顺带说明这一条对选型的影响。它支持候选 C 的一个判断，加载应该是「token 匹配那次迁移的副作用」，而不是一个先做再判的动作。

## 模块图

新增。

- `crates/model/src/mode.rs`，`PlayMode`、`VideoRate`
- `crates/bili/src/dash.rs`，`VideoStream`、`to_mpd`
- `crates/bili/src/watch.rs`，`WatchPlan` 组装，detail 加 playurl 加挑流
- `crates/bili/src/comments.rs`，评论与嵌套回复
- `crates/bili/src/feed.rs`，首页推荐
- `apps/desktop/src-tauri/src/media.rs`，`HandleTable` 与 `/m/<handle>` 代理，取代 `mv.rs`
- `apps/desktop/src/features/watch/WatchView.tsx`
- `apps/desktop/src/features/watch/VideoSurface.tsx`，shaka 挂载与切档
- `apps/desktop/src/features/watch/QualityMenu.tsx`
- `apps/desktop/src/features/watch/PageList.tsx`
- `apps/desktop/src/features/watch/CommentsPanel.tsx`
- `apps/desktop/src/shared/lib/drift.ts`，`DriftPolicy` 的前端部分与心跳

改动。

- `crates/core/src/engine.rs`，新增 `open_watch`、`set_watch_quality`、`set_mode`，快照加 `mode`
- `crates/core/src/wire.rs`，`Download` 载荷改成 `DownloadView`，去掉 `serde_json::Value`
- `crates/core/tests/contract.rs`，双向断言加样本函数
- `apps/desktop/src/app/appStore.ts`，`View` 加 `watch`
- `apps/desktop/src/features/tracks/TrackGrid.tsx`，卡片点击进观看页
- `apps/desktop/src/app/ChannelBar.tsx`，频道项改成发现、影视、音乐、收藏、历史

删除。

- `apps/desktop/src/features/player/MvOverlay.tsx`，MV 并入观看页
- `apps/desktop/src-tauri/src/mv.rs`，被 `media.rs` 取代

不动。

`crates/audio` 全部。`crates/store` 全部。`crates/bili/src/client.rs`、`media.rs`。六套音乐界面。弹幕两层。
