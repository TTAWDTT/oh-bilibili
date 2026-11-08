# 播放器状态机验证

`Player.tla` 是播放器相位的有限状态模型，`Player.cfg` 是配置，`view.ts` 负责把状态
翻译成给人看的中文标签与配色。

复现需要 Java 11+ 与 tla2tools.jar：

```sh
curl -L -o ~/tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar

export JAVA=/path/to/java
export TLA2TOOLS=~/tla2tools.jar

node /path/to/statechart/scripts/statechart.ts \
  docs/verification/Player.tla \
  --config docs/verification/Player.cfg \
  --view docs/verification/view.ts \
  --out /tmp/player-chart
```

运行结果：47 个状态、95 步，`FreshSource`、`NoSourceWhenIdle`、`PositionNeverRewinds`
与 `NoDeadlock` 全部成立。

模型刻意省略的东西：seek、音量、循环模式、多音轨降级、播放队列。这几条在代码里由
`crates/core/src/state.rs` 的单元测试覆盖，不在这份规格里。
