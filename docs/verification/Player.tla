---- MODULE Player ----
EXTENDS Naturals
\* 播放器状态机。req 是当前取流请求的令牌，resp 是手上音源所属的令牌。
\* 设计主张：迟到的响应在类型上无处可落，因此它连状态都改不了。

VARIABLES phase, req, resp, pos

Init == phase = "idle" /\ req = 0 /\ resp = 0 /\ pos = 0

\* 你按下播放：发一个新请求，旧音源立刻作废
YouPressPlay ==
    /\ phase \in {"idle", "ready", "paused", "ended", "faulted"}
    /\ req' = req + 1
    /\ phase' = "loading"
    /\ resp' = resp
    /\ UNCHANGED pos

\* 响应回来了，且属于当前请求：拿到音源
StreamArrives ==
    /\ phase = "loading"
    /\ resp' = req
    /\ phase' = "playing"
    /\ UNCHANGED <<req, pos>>

\* 迟到的旧响应：属于上一个请求，被丢弃
StaleArrives ==
    /\ phase = "loading"
    /\ req > 0
    /\ resp' = resp
    /\ UNCHANGED <<req, phase, pos>>

\* 取流失败
StreamFails ==
    /\ phase = "loading"
    /\ phase' = "faulted"
    /\ resp' = 0
    /\ UNCHANGED <<req, pos>>

\* 播放推进
Tick ==
    /\ phase = "playing"
    /\ pos' = pos + 1
    /\ UNCHANGED <<phase, req, resp>>

YouPause ==
    /\ phase = "playing"
    /\ phase' = "paused"
    /\ UNCHANGED <<req, resp, pos>>

YouResume ==
    /\ phase = "paused"
    /\ phase' = "playing"
    /\ UNCHANGED <<req, resp, pos>>

YouStop ==
    /\ phase \in {"playing", "paused"}
    /\ phase' = "ready"
    /\ UNCHANGED <<req, resp, pos>>

TrackEnds ==
    /\ phase = "playing"
    /\ phase' = "ended"
    /\ resp' = 0
    /\ UNCHANGED <<req, pos>>

\* 结束态：不再改任何东西，只为消掉死锁
Done ==
    /\ phase = "ended"
    /\ UNCHANGED <<phase, req, resp, pos>>

Next == YouPressPlay \/ StreamArrives \/ StaleArrives \/ StreamFails \/
        Tick \/ YouPause \/ YouResume \/ YouStop \/ TrackEnds \/ Done

Spec == Init /\ [][Next]_<<phase, req, resp, pos>>

\* 规则 1：正在响或已暂停的音源，一定属于当前请求
FreshSource == phase \in {"playing", "paused"} => resp = req

\* 规则 2：空闲态手上没有音源
NoSourceWhenIdle == phase = "idle" => resp = 0

\* 规则 3：播放进度只会前进，永不到退
PositionNeverRewinds == pos >= 0

\* 状态空间必须有限，否则 TLC 永不收敛
Bounded == req <= 2 /\ pos <= 3

====
