---- MODULE Watch ----
EXTENDS Naturals, TLC

\* 一个观看会话。听与看是同一个会话的两个目标状态。
VARIABLES target, surface, sound

Vars == <<target, surface, sound>>

TypeOK ==
  /\ target  \in {"listen", "watch"}
  /\ surface \in {"absent", "attaching", "live", "stale"}
  /\ sound   \in {"idle", "playing", "paused", "ended"}

Init == /\ target = "listen" /\ surface = "absent" /\ sound = "idle"

\* 声音只在开始放一次，之后切视图不重载
SoundStarts ==
  /\ sound = "idle"
  /\ sound' = "playing"
  /\ UNCHANGED <<target, surface>>

\* 你按下「看」：只挂画面，声音不动
PressWatch ==
  /\ target = "listen" /\ surface = "absent"
  /\ sound \in {"playing", "paused"}
  /\ target' = "watch" /\ surface' = "attaching"
  /\ UNCHANGED sound

SurfaceReady ==
  /\ surface = "attaching"
  /\ surface' = "live"
  /\ UNCHANGED <<target, sound>>

\* 换画质：只换画面档，声音与时钟都不动
RateChange ==
  /\ surface = "live"
  /\ surface' = "attaching"
  /\ UNCHANGED <<target, sound>>

\* 你按下「听视频」：卸画面，声音继续
PressListen ==
  /\ target = "watch" /\ surface \in {"attaching", "live"}
  /\ target' = "listen" /\ surface' = "absent"
  /\ UNCHANGED sound

\* 画面汇报断流太久：同一步里退回听，不留下在看却没画面的状态
DetectStale ==
  /\ surface \in {"live", "attaching"}
  /\ surface' = "stale" /\ target' = "listen"
  /\ UNCHANGED sound

ClearStale ==
  /\ surface = "stale"
  /\ surface' = "absent"
  /\ UNCHANGED <<target, sound>>

PressPause ==
  /\ sound = "playing"
  /\ sound' = "paused"
  /\ UNCHANGED <<target, surface>>

PressResume ==
  /\ sound = "paused"
  /\ sound' = "playing"
  /\ UNCHANGED <<target, surface>>

\* 只有画面已经卸掉时才算自然播完
SoundEnds ==
  /\ sound = "playing" /\ surface = "absent"
  /\ sound' = "ended"
  /\ UNCHANGED <<target, surface>>

Done == /\ sound = "ended" /\ UNCHANGED Vars

Next ==
  \/ SoundStarts \/ PressWatch \/ SurfaceReady \/ RateChange
  \/ PressListen \/ DetectStale \/ ClearStale
  \/ PressPause \/ PressResume \/ SoundEnds \/ Done

Spec == Init /\ [][Next]_Vars

\* R1 画面挂着的时候一定在看模式。stale 表示画面已经丢了，不算挂着。
R1 == surface \in {"attaching", "live"} => target = "watch"

\* R2 有画面时一定有声音会话，画面不能脱离声音单独存在
R2 == surface /= "absent" => sound \in {"playing", "paused"}

\* R3 画面卡住时已经退回听，不存在「在看却没画面」
R3 == surface = "stale" => target = "listen"

====
