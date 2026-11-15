# oh-bilibili 架构契约

本文是实现的唯一契约。三份并行设计经交叉评审后收敛于此，偏离本文要有理由，理由写进本文。

## 一、五条架构守则

1. **播放位置的真值只在声卡侧。** 播放器状态里没有 `position` 字段，UI 拿到的是投影快照。三份独立设计各自得出同一条结论，这是本项目最重要的决定。
2. **wire 类型不出 `bili`。** B 站返回的 JSON 解析在 `bili` 内部完成，出门只有领域类型。
3. **依赖方向由 `cargo` 校验，不由评审意见保证。** 有一条测试读 `cargo metadata` 断言允许的边。
4. **播放位置只由声卡线程写。** `Clock` 是唯一的帧计数来源，其他任何地方都只读。状态机的迁移全是显式方法的返回值，没有「拿到就随手赋值」的路径。
5. **迁移只追加，一事务一版本，用 `PRAGMA user_version`。**

## 二、crate 依赖图

```
model  ←  bili
       ←  store
       ←  audio
       ←  core  ←  apps/desktop/src-tauri
```

五个 crate。`lyrics` 与 `download` 不单独成 crate：它们各自只有一个模块，没有需要 crate 边界保护的独立不变量。多一个 crate 就多一处必须同步修改的地方。

| crate | 拥有什么 | 绝不做 |
|---|---|---|
| `model` | 词汇表与值对象不变量（`TrackKey` 不可拆、`Quality` 闭集有序、`Volume` 构造即夹紧、`Millis`） | 不认识 HTTP、SQL、声卡 |
| `bili` | wbi 签名、指纹、cookie 罐、限速闸门、风控冷却、搜索清洗与打分、取流候选选择 | 不认识数据库与播放器 |
| `store` | SQLite schema、迁移、键集分页游标、`reactions` 唯一同步算法 | 不认识 B 站，只存不透明的 `provider_key` |
| `audio` | symphonia 解码、rubato 重采样、cpal 输出、帧计数时钟 | 不认识 URL。只吃 `MediaBytes = Box<dyn Read + Seek + Send>` |
| `core` | 四条状态机、队列、编排、歌词、下载、IPC 契约类型 | 不直接拼 B 站 URL，不直接写 SQL 字符串 |

`audio` 只吃 `Read + Seek` 是有代价的决定：seek 时的 Range 重开发生在解码线程，可能停顿几十毫秒。换来的是「只有 `bili` 知道 B 站长什么样」这条边界不被破坏。

## 三、队列的身份模型

```rust
struct QueueEntry { id: EntryId, key: TrackKey }
struct Queue {
    entries: Vec<QueueEntry>,   // 权威顺序
    cursor: Option<EntryId>,    // 身份，不是下标
    mode: PlayMode,             // 正交的值，不进状态机
}
enum PlayOrder {
    InOrder,
    Shuffle { perm: Vec<EntryId>, at: usize },  // 排列的元素是 EntryId
}
```

用下标做身份会让「重排 + 随机」互相踩，这是两份设计共同踩过的坑。关掉随机必须还原原序，所以排列不能就地打乱。

## 四、播放器状态机

```rust
// mod state 私有。变体自带该状态的证据字段，因此「播放中却没有音源」写不出来。
enum PlayerState {
    Idle,
    Loading { token: LoadToken, track: TrackKey },
    Ready { token: LoadToken, track: TrackKey, stream: Prepared },
    Playing { token: LoadToken, track: TrackKey, stream: Prepared,
              prefetched: Option<Prefetched> },
    Paused { track: TrackKey, stream: Prepared },
    Ended { track: TrackKey },
    Faulted { track: TrackKey, fault: Fault },
}
```

两条必须成立的性质，用 TLC 验证过，规格在 `docs/verification/Player.tla`：

- `FreshSource`：`playing` 或 `paused` 时手上的音源一定属于当前 `token`。
- `NoSourceWhenIdle`：空闲态手里没有音源。
- `PositionNeverRewinds`：进度永不倒退。
- 无死锁。

有限状态模型共 47 个状态、95 步，三条规则全部成立。模型省略了 seek、音量、循环模式、
多音轨降级与播放队列。复现命令见 `docs/verification/README.md`。

`LoadToken` 单调递增。迟到的取流响应因为 token 不匹配，在类型上无处可落。这是 c-1 与 c-2 争论的那个竞态的答案。

**预取必须有落点。** `Playing.prefetched` 就是这个落点：预取结果以 `Resolved { token: next }` 回来时，机器虽然处于 `Playing`，但 `token` 匹配下一个条目，于是落进 `prefetched` 槽。没有这个字段，预取就是有出口没有落点，150ms 切歌预算无从兑现。

## 五、同步：意图与状态分开

```sql
CREATE TABLE reactions (
  track_id    INTEGER NOT NULL,
  mid         INTEGER NOT NULL,   -- 账号戳，换号不推错人
  kind        TEXT    NOT NULL,   -- 'like' | 'fav'
  want        INTEGER NOT NULL,   -- 0 表示想取消。意图本身要能离线存在
  state       TEXT    NOT NULL,   -- 'pending' | 'synced' | 'rejected' | 'stale'
  attempts    INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  synced_at   INTEGER,
  PRIMARY KEY (track_id, mid, kind)
);
CREATE INDEX idx_reactions_pending ON reactions(mid, state);
```

- 取消喜欢不是「删行」，是 `want = 0`。删行等于丢掉意图。
- 换号时 `UPDATE reactions SET state = 'stale' WHERE mid <> ?`，一条幂等 UPDATE，不是一堆特例分支。
- 落盘只存**想要什么**（`want`）和**到哪一步**（`state`）。并发控制目前靠「一次只推 20 条」的串行循环，没有单独的租约机器；这是简化，文档与代码一致。

## 六、错误只有一个形状

```rust
#[serde(tag = "class", rename_all = "snake_case")]
pub enum WireError {
    Retryable { message: String, retry_after_ms: Option<u64> },
    RateLimited { message: String, retry_after_ms: u64 },
    NeedsLogin { message: String },
    Input { message: String, field: Option<String> },
    Internal { message: String },
}
```

命令失败与后台 `notice` 事件用同一个形状。UI 只有一处 `switch (class)`。四十多个错误出口都用构造器产生，不写字面量。

## 七、歌单排序

`sort_key INTEGER` 用分数间隔（步长 1024），重排只改一行。不用 `PRIMARY KEY (playlist_id, sort)`：SQLite 的唯一约束逐行即时检查，平移 UPDATE 必然撞唯一键。这是 c-1 的致命缺陷，别再犯。

## 八、三条被否决的备选

| 备选 | 否决理由 |
|---|---|
| `Arc<Mutex<PlayerState>>` + 多把锁 | 两头写同一份状态；「最近一次 seek 与迟到的取流响应谁赢」变成竞态 |
| 队列顺序存 `Vec<usize>`，随机时原地打乱 | 关随机无法还原，重排会破坏随机历史 |
| `bili` 直接返回 `audio::Stream` | 把 cpal/symphonia 拉进网络层，且降级策略下沉进协议层 |

## 九、实现顺序

先 `model` 与 `bili` 的第一条竖切：`SearchQuery::parse → Source::search`，全部离线可测，再打通真实接口。这条竖切跑通，「边界内解析 + 窄接口」就从主张变成事实，后面每个 crate 照抄这个形状。

## 十、已知缺口

- 登录、点赞、收藏的真机验证需要用户账号。代码路径用 fixture 测，线上成功性不作为已完成项。
- `cargo public-api` 闸门未接入。依赖方向已由 `crates/core/tests/deps.rs` 用 `cargo metadata` 断言。
- 播放队列不跨重启恢复，这是 v1 的明确非目标。
